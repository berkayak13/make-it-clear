// Pure planning logic for the master/sub-narrator renarration hierarchy.
// No chrome.* or network access — every function here is deterministic on its
// inputs so the planner can be unit-tested without the pipeline.

const FACT_KIND_LABEL = {
  FACT: 'Fact',
  CLAIM: 'Claim',
  QUOTE: 'Quote',
  FIGURE: 'Figure',
  COUNTER: 'Counterpoint',
  VISUAL: 'Visual',
};

// Renders the extraction's structured facts into stable numbered lines — the
// shared currency between the master planner (which assigns fact NUMBERS to
// sections) and the sub-narrators (which receive the full LINES). Internal
// plumbing (id, confidence, sectionIds, imageIds) is intentionally omitted;
// evidence is appended only when it adds information.
export function buildFactLines(facts) {
  const list = Array.isArray(facts) ? facts : [];
  const lines = [];
  for (const fact of list) {
    const text = typeof fact === 'string' ? fact : String(fact?.text || fact?.content || '').trim();
    if (!text) continue;
    const kind = typeof fact === 'object' ? String(fact?.kind || '').toUpperCase() : '';
    const label = FACT_KIND_LABEL[kind] || 'Point';
    const evidence = typeof fact === 'object' ? String(fact?.evidence || '').trim() : '';
    const number = lines.length + 1;
    let line = `${number}. ${label}: ${text}`;
    if (evidence && evidence.toLowerCase() !== text.toLowerCase()) {
      line += ` (Evidence: ${evidence})`;
    }
    lines.push({ number, line });
  }
  return lines;
}

// Validates the master planner's outline against the fact list. Every fact
// number 1..factCount must end up in exactly one section: duplicates keep
// their first assignment, out-of-range or non-integer numbers are dropped,
// and any facts the planner forgot are appended as a trailing section so no
// fact is ever lost to a sloppy plan. Returns null when the plan is unusable
// (caller falls back to the local partitioner).
export function normalizePlan(rawSections, factCount) {
  if (!Array.isArray(rawSections) || !factCount) return null;
  const assigned = new Set();
  const sections = [];
  for (const raw of rawSections) {
    const title = String(raw?.title || '').trim();
    const factNumbers = [];
    for (const value of Array.isArray(raw?.factNumbers) ? raw.factNumbers : []) {
      const number = Number(value);
      if (!Number.isInteger(number) || number < 1 || number > factCount || assigned.has(number)) continue;
      assigned.add(number);
      factNumbers.push(number);
    }
    if (factNumbers.length) sections.push({ title, factNumbers });
  }
  if (!sections.length) return null;
  const missing = [];
  for (let number = 1; number <= factCount; number += 1) {
    if (!assigned.has(number)) missing.push(number);
  }
  if (missing.length) sections.push({ title: 'Other details', factNumbers: missing });
  return sections;
}

function sectionChars(factNumbers, factLines) {
  return factNumbers.reduce((sum, number) => sum + (factLines[number - 1]?.line.length || 0), 0);
}

// Caps how much content any one sub-narrator receives. A section whose facts
// exceed maxChars is split in order into "(part N)" siblings, keeping every
// fact and the planner's ordering — each part stays well inside one call's
// timeout and output budget, so no section can truncate.
export function splitOversizedSections(sections, factLines, maxChars) {
  const output = [];
  for (const section of sections || []) {
    if (sectionChars(section.factNumbers, factLines) <= maxChars) {
      output.push(section);
      continue;
    }
    let part = [];
    let partChars = 0;
    let partIndex = 0;
    const flush = () => {
      if (!part.length) return;
      partIndex += 1;
      output.push({
        title: partIndex === 1 ? section.title : `${section.title} (part ${partIndex})`,
        factNumbers: part,
      });
      part = [];
      partChars = 0;
    };
    for (const number of section.factNumbers) {
      const chars = factLines[number - 1]?.line.length || 0;
      if (part.length && partChars + chars > maxChars) flush();
      part.push(number);
      partChars += chars;
    }
    flush();
  }
  return output;
}

// Rule-based fallback partition for when the master planner's LLM call fails:
// greedy in-order chunks under the char budget. Untitled — the sub-narrators
// open their part of the page directly.
export function planSectionsLocally(factLines, maxChars) {
  const sections = [];
  let current = [];
  let currentChars = 0;
  const flush = () => {
    if (!current.length) return;
    sections.push({ title: '', factNumbers: current });
    current = [];
    currentChars = 0;
  };
  for (const { number, line } of factLines || []) {
    if (current.length && currentChars + line.length > maxChars) flush();
    current.push(number);
    currentChars += line.length;
  }
  flush();
  return sections;
}

// Stitches the sub-narrators' section narratives back into one plain-text
// document. Titles become standalone heading lines; a section with no
// narrative contributes nothing (callers substitute a deterministic fallback
// rendering BEFORE assembly so content is never dropped here).
export function assembleRenarration(parts) {
  const blocks = [];
  for (const part of parts || []) {
    const text = String(part?.text || '').trim();
    if (!text) continue;
    const title = String(part?.title || '').trim();
    if (title) blocks.push(title);
    blocks.push(text);
  }
  return blocks.join('\n\n');
}
