// Pure logic for applying the consolidation selector's plan to the candidate
// fact set. The selector LLM returns only INSTRUCTIONS (ids to drop, groups to
// merge) — never regenerated fact text — so its output stays tiny no matter how
// large the page is. This module applies those instructions defensively: any
// malformed or conflicting instruction is ignored rather than losing content.

function uniqueIds(...lists) {
  const seen = new Set();
  const output = [];
  for (const list of lists) {
    for (const value of list || []) {
      const id = String(value || '').trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      output.push(id);
    }
  }
  return output;
}

// Applies { drops: [id], merges: [{ keep: id, absorb: [id] }] } to the facts.
// Rules, biased toward never losing content:
//   - unknown ids are ignored
//   - each fact can be claimed (absorbed) at most once; first claim wins
//   - a merge keeper is immune to drops and to being absorbed elsewhere
//   - merging unions sectionIds/imageIds, keeps the higher confidence, marks
//     source 'mixed' when text- and image-sourced facts merge, and keeps the
//     keeper's text (near-duplicates overlap by definition)
// Returns surviving facts in their original order plus counts for logging.
export function applyConsolidationPlan(facts, plan) {
  const input = Array.isArray(facts) ? facts : [];
  const drops = Array.isArray(plan?.drops) ? plan.drops : [];
  const merges = Array.isArray(plan?.merges) ? plan.merges : [];

  const byId = new Map(input.map((fact) => [fact.id, fact]));
  const keepers = new Set();
  const absorbed = new Set();
  const mergedInto = new Map(); // keeper id -> merged fact object

  for (const merge of merges) {
    const keepId = String(merge?.keep || '').trim();
    const keeper = byId.get(keepId);
    if (!keeper || absorbed.has(keepId)) continue;
    for (const rawId of Array.isArray(merge?.absorb) ? merge.absorb : []) {
      const absorbId = String(rawId || '').trim();
      const victim = byId.get(absorbId);
      if (!victim || absorbId === keepId || absorbed.has(absorbId) || keepers.has(absorbId)) continue;
      absorbed.add(absorbId);
      keepers.add(keepId);
      const base = mergedInto.get(keepId) || { ...keeper };
      mergedInto.set(keepId, {
        ...base,
        evidence: base.evidence || victim.evidence,
        confidence: Math.max(base.confidence ?? 0, victim.confidence ?? 0),
        source: base.source === victim.source ? base.source : 'mixed',
        sectionIds: uniqueIds(base.sectionIds, victim.sectionIds),
        imageIds: uniqueIds(base.imageIds, victim.imageIds),
      });
    }
  }

  const dropped = new Set();
  for (const rawId of drops) {
    const dropId = String(rawId || '').trim();
    if (!byId.has(dropId) || keepers.has(dropId) || absorbed.has(dropId)) continue;
    dropped.add(dropId);
  }

  const output = [];
  for (const fact of input) {
    if (absorbed.has(fact.id) || dropped.has(fact.id)) continue;
    output.push(mergedInto.get(fact.id) || fact);
  }

  return { facts: output, droppedCount: dropped.size, mergedCount: absorbed.size };
}
