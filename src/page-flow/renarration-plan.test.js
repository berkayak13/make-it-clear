import { describe, it, expect } from 'vitest';
import {
  buildFactLines,
  normalizePlan,
  splitOversizedSections,
  planSectionsLocally,
  assembleRenarration,
} from './renarration-plan.js';

const facts = (n) =>
  Array.from({ length: n }, (_, i) => ({ kind: 'FACT', text: `fact number ${i + 1}` }));

describe('buildFactLines', () => {
  it('numbers every non-empty fact and labels its kind', () => {
    const lines = buildFactLines([
      { kind: 'FIGURE', text: 'Revenue rose 12%' },
      { kind: 'QUOTE', text: 'We did it', evidence: 'CEO interview' },
      { text: '' },
      'plain string fact',
    ]);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({ number: 1 });
    expect(lines[0].line).toBe('1. Figure: Revenue rose 12%');
    expect(lines[1].line).toBe('2. Quote: We did it (Evidence: CEO interview)');
    expect(lines[2].line).toBe('3. Point: plain string fact');
  });

  it('omits evidence that merely repeats the fact text', () => {
    const lines = buildFactLines([{ kind: 'FACT', text: 'Water is wet', evidence: 'water is wet' }]);
    expect(lines[0].line).toBe('1. Fact: Water is wet');
  });
});

describe('normalizePlan', () => {
  it('keeps a valid plan intact, preserving section order', () => {
    const plan = normalizePlan(
      [
        { title: 'Core findings', factNumbers: [2, 3] },
        { title: 'Background', factNumbers: [1, 4] },
      ],
      4,
    );
    expect(plan).toEqual([
      { title: 'Core findings', factNumbers: [2, 3] },
      { title: 'Background', factNumbers: [1, 4] },
    ]);
  });

  it('drops duplicates (first assignment wins) and out-of-range numbers', () => {
    const plan = normalizePlan(
      [
        { title: 'A', factNumbers: [1, 2, 99, 0, -3, 2.5] },
        { title: 'B', factNumbers: [2, 3] },
      ],
      3,
    );
    expect(plan).toEqual([
      { title: 'A', factNumbers: [1, 2] },
      { title: 'B', factNumbers: [3] },
    ]);
  });

  it('appends facts the planner forgot so nothing is ever lost', () => {
    const plan = normalizePlan([{ title: 'Only some', factNumbers: [2] }], 4);
    const assigned = plan.flatMap((section) => section.factNumbers).sort((a, b) => a - b);
    expect(assigned).toEqual([1, 2, 3, 4]);
    expect(plan[plan.length - 1].factNumbers).toEqual([1, 3, 4]);
  });

  it('drops sections left empty after cleaning', () => {
    const plan = normalizePlan(
      [
        { title: 'Ghost', factNumbers: [99] },
        { title: 'Real', factNumbers: [1, 2] },
      ],
      2,
    );
    expect(plan).toEqual([{ title: 'Real', factNumbers: [1, 2] }]);
  });

  it('returns null for an unusable plan', () => {
    expect(normalizePlan([], 3)).toBeNull();
    expect(normalizePlan(null, 3)).toBeNull();
    expect(normalizePlan([{ title: 'x', factNumbers: [] }], 3)).toBeNull();
  });
});

describe('planSectionsLocally', () => {
  it('covers every fact exactly once, in order', () => {
    const lines = buildFactLines(facts(10));
    const sections = planSectionsLocally(lines, 100);
    const assigned = sections.flatMap((section) => section.factNumbers);
    expect(assigned).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('respects the per-section char budget where possible', () => {
    const lines = buildFactLines(facts(10));
    const maxChars = 60;
    const sections = planSectionsLocally(lines, maxChars);
    expect(sections.length).toBeGreaterThan(1);
    for (const section of sections) {
      const chars = section.factNumbers
        .map((n) => lines[n - 1].line.length)
        .reduce((a, b) => a + b, 0);
      // A single oversized fact may exceed the budget alone, but never two together.
      if (section.factNumbers.length > 1) expect(chars).toBeLessThanOrEqual(maxChars);
    }
  });

  it('gives an oversized single fact its own section instead of dropping it', () => {
    const lines = buildFactLines([{ kind: 'FACT', text: 'x'.repeat(500) }, ...facts(2)]);
    const sections = planSectionsLocally(lines, 100);
    const assigned = sections.flatMap((section) => section.factNumbers).sort((a, b) => a - b);
    expect(assigned).toEqual([1, 2, 3]);
  });
});

describe('splitOversizedSections', () => {
  it('splits a section whose facts exceed the budget into parts', () => {
    const lines = buildFactLines(facts(8));
    const sections = [{ title: 'Everything', factNumbers: [1, 2, 3, 4, 5, 6, 7, 8] }];
    const split = splitOversizedSections(sections, lines, 60);
    expect(split.length).toBeGreaterThan(1);
    expect(split[0].title).toBe('Everything');
    expect(split[1].title).toBe('Everything (part 2)');
    const assigned = split.flatMap((section) => section.factNumbers);
    expect(assigned).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('leaves sections within budget untouched', () => {
    const lines = buildFactLines(facts(4));
    const sections = [
      { title: 'A', factNumbers: [1, 2] },
      { title: 'B', factNumbers: [3, 4] },
    ];
    expect(splitOversizedSections(sections, lines, 10000)).toEqual(sections);
  });
});

describe('assembleRenarration', () => {
  it('joins titled section narratives into one plain-text document', () => {
    const text = assembleRenarration([
      { title: 'Opening', text: 'First part.' },
      { title: 'Details', text: 'Second part.' },
    ]);
    expect(text).toBe('Opening\n\nFirst part.\n\nDetails\n\nSecond part.');
  });

  it('skips empty titles but never drops narrative text', () => {
    const text = assembleRenarration([
      { title: '', text: 'Only body.' },
      { title: 'T', text: '' },
      { title: 'End', text: 'Closing.' },
    ]);
    expect(text).toBe('Only body.\n\nEnd\n\nClosing.');
  });
});
