/**
 * fzy-lite 打分器：子序列匹配 + 前缀/连续/单词开头奖励 + gap 惩罚。
 * 返回 null 表示不匹配。matches 是命中字符在 target 中的下标，用于高亮。
 */
export interface FuzzyResult {
  score: number;
  matches: number[];
}

const BONUS_PREFIX = 4;
const BONUS_CONSECUTIVE = 2;
const BONUS_WORD_START = 1.5;
const PENALTY_GAP = -0.05;

export function score(query: string, target: string): FuzzyResult | null {
  if (query.length === 0) return { score: 0, matches: [] };
  const q = query.toLowerCase();
  const t = target.toLowerCase();

  const matches: number[] = [];
  let qi = 0;
  let sc = 0;
  let lastMatch = -1;

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      matches.push(ti);
      if (ti === 0 && qi === 0) sc += BONUS_PREFIX;
      if (lastMatch === ti - 1 && qi > 0) sc += BONUS_CONSECUTIVE;
      const prev = target[ti - 1];
      const isWordStart = ti === 0 || prev === '/' || prev === '-' || prev === '_' || prev === '.' || prev === ' ';
      if (isWordStart) sc += BONUS_WORD_START;
      if (lastMatch >= 0) sc += PENALTY_GAP * (ti - lastMatch - 1);
      lastMatch = ti;
      qi++;
    }
  }

  if (qi < q.length) return null;
  return { score: sc, matches };
}
