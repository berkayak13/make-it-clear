import { describe, it, expect } from 'vitest';
import { applyConsolidationPlan } from './fact-consolidate.js';

const fact = (id, text, extra = {}) => ({
  id,
  kind: 'FACT',
  text,
  evidence: '',
  confidence: 0.75,
  source: 'text',
  sectionIds: [],
  imageIds: [],
  provenance: 'page',
  ...extra,
});

const facts = () => [
  fact('fact-1', 'Revenue rose 12% in 2025', { sectionIds: ['s1'], confidence: 0.9 }),
  fact('fact-2', 'Revenue went up twelve percent', { sectionIds: ['s2'], source: 'image', imageIds: ['img-1'], confidence: 0.6 }),
  fact('fact-3', 'Subscribe to our newsletter'),
  fact('fact-4', 'The CEO founded the company in 2010'),
];

describe('applyConsolidationPlan', () => {
  it('merges duplicates into the kept fact, unioning references', () => {
    const { facts: out, mergedCount } = applyConsolidationPlan(facts(), {
      drops: [],
      merges: [{ keep: 'fact-1', absorb: ['fact-2'] }],
    });
    expect(mergedCount).toBe(1);
    expect(out.map((f) => f.id)).toEqual(['fact-1', 'fact-3', 'fact-4']);
    const kept = out[0];
    expect(kept.text).toBe('Revenue rose 12% in 2025');
    expect(kept.sectionIds).toEqual(['s1', 's2']);
    expect(kept.imageIds).toEqual(['img-1']);
    expect(kept.source).toBe('mixed');
    expect(kept.confidence).toBe(0.9);
  });

  it('drops chrome facts', () => {
    const { facts: out, droppedCount } = applyConsolidationPlan(facts(), {
      drops: ['fact-3'],
      merges: [],
    });
    expect(droppedCount).toBe(1);
    expect(out.map((f) => f.id)).toEqual(['fact-1', 'fact-2', 'fact-4']);
  });

  it('never drops a fact that is also a merge keeper (no-loss bias)', () => {
    const { facts: out } = applyConsolidationPlan(facts(), {
      drops: ['fact-1'],
      merges: [{ keep: 'fact-1', absorb: ['fact-2'] }],
    });
    expect(out.map((f) => f.id)).toContain('fact-1');
  });

  it('ignores unknown ids, self-absorption, and double-claimed facts', () => {
    const { facts: out } = applyConsolidationPlan(facts(), {
      drops: ['fact-99'],
      merges: [
        { keep: 'fact-1', absorb: ['fact-1', 'fact-2', 'fact-99'] },
        { keep: 'fact-4', absorb: ['fact-2'] },
      ],
    });
    expect(out.map((f) => f.id)).toEqual(['fact-1', 'fact-3', 'fact-4']);
    expect(out[2].sectionIds).toEqual([]);
  });

  it('returns the input unchanged for a malformed plan', () => {
    const input = facts();
    for (const plan of [null, {}, { drops: 'x', merges: 'y' }]) {
      const { facts: out, droppedCount, mergedCount } = applyConsolidationPlan(input, plan);
      expect(out).toEqual(input);
      expect(droppedCount).toBe(0);
      expect(mergedCount).toBe(0);
    }
  });

  it('preserves original fact order', () => {
    const { facts: out } = applyConsolidationPlan(facts(), {
      drops: ['fact-2'],
      merges: [{ keep: 'fact-4', absorb: ['fact-3'] }],
    });
    expect(out.map((f) => f.id)).toEqual(['fact-1', 'fact-4']);
  });
});
