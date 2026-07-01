import { describe, it, expect } from 'vitest';
import { score } from '../../src/fuzzy/score.js';

describe('fuzzy score', () => {
  it('exact prefix beats subsequence', () => {
    const prefix = score('mod', 'model')!;
    const subseq = score('mod', 'summod')!;
    expect(prefix.score).toBeGreaterThan(subseq.score);
  });

  it('returns null when query chars missing', () => {
    expect(score('xyz', 'model')).toBeNull();
  });

  it('empty query matches everything with score 0', () => {
    const r = score('', 'anything')!;
    expect(r.score).toBe(0);
    expect(r.matches).toEqual([]);
  });

  it('captures match indices for highlighting', () => {
    const r = score('me', 'memory')!;
    expect(r.matches).toEqual([0, 1]);
  });

  it('is case-insensitive', () => {
    expect(score('Mo', 'model')).not.toBeNull();
    expect(score('MO', 'model')).not.toBeNull();
  });

  it('consecutive matches score higher than scattered', () => {
    const cons = score('ab', 'abcxyz')!;
    const scat = score('ab', 'axbxyz')!;
    expect(cons.score).toBeGreaterThan(scat.score);
  });
});
