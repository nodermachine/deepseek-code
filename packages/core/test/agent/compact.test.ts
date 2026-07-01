import { describe, it, expect } from 'vitest';
import { estimateTokens, needsCompact, splitForCompact } from '../../src/agent/compact.js';
import type { Message } from '../../src/types.js';

describe('estimateTokens', () => {
  it('estimates English text at ~4 chars/token', () => {
    const msgs: Message[] = [
      { role: 'user', content: 'hello' },   // 5 chars
      { role: 'assistant', content: 'world' }, // 5 chars
    ];
    // total 10 English chars / 4 ≈ 3 tokens
    expect(estimateTokens(msgs)).toBe(3);
  });

  it('estimates Chinese text at ~1.8 chars/token', () => {
    const msgs: Message[] = [
      { role: 'user', content: '你好世界' }, // 4 CJK chars / 1.8 ≈ 3 tokens
    ];
    expect(estimateTokens(msgs)).toBeGreaterThanOrEqual(2);
    expect(estimateTokens(msgs)).toBeLessThanOrEqual(3);
  });

  it('includes tool_calls in estimation', () => {
    const msgs: Message[] = [
      { role: 'assistant', content: null, tool_calls: [{ id: 'x', type: 'function', function: { name: 'Read', arguments: '{"file_path":"/a.ts"}' } }] },
    ];
    expect(estimateTokens(msgs)).toBeGreaterThan(10);
  });
});

describe('needsCompact', () => {
  it('returns false for short conversations', () => {
    const msgs: Message[] = [{ role: 'user', content: 'hi' }];
    expect(needsCompact(msgs)).toBe(false);
  });

  it('returns true when exceeding threshold', () => {
    // 创建大量英文内容使其超过阈值
    const longContent = 'x'.repeat(250000); // 250K English chars / 4 = 62.5K tokens > 64K * 0.8 = 51.2K
    const msgs: Message[] = [{ role: 'user', content: longContent }];
    expect(needsCompact(msgs)).toBe(true);
  });

  it('respects custom opts', () => {
    const content = 'x'.repeat(4000); // 4000 English chars / 4 = 1000 tokens
    const msgs: Message[] = [{ role: 'user', content }];
    expect(needsCompact(msgs, { maxContextTokens: 1000, thresholdRatio: 0.8 })).toBe(true);
    expect(needsCompact(msgs, { maxContextTokens: 2000, thresholdRatio: 0.8 })).toBe(false);
  });
});

describe('splitForCompact', () => {
  it('keeps system messages in toKeep', () => {
    const msgs: Message[] = [
      { role: 'system', content: 'you are helpful' },
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'q2' },
      { role: 'assistant', content: 'a2' },
    ];
    const { toCompress, toKeep } = splitForCompact(msgs, { keepRecentTurns: 1 });
    // 保留最后 1 轮 (q2+a2) + system
    expect(toKeep.find(m => m.role === 'system')).toBeDefined();
    expect(toKeep.filter(m => m.role === 'user')).toHaveLength(1);
    expect(toKeep.filter(m => m.role === 'user')[0].content).toBe('q2');
    expect(toCompress).toHaveLength(2); // q1 + a1
  });

  it('keeps all when turns <= keepRecentTurns', () => {
    const msgs: Message[] = [
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
    ];
    const { toCompress, toKeep } = splitForCompact(msgs, { keepRecentTurns: 6 });
    expect(toCompress).toHaveLength(0);
    expect(toKeep).toHaveLength(2);
  });

  it('splits correctly with multiple turns', () => {
    const msgs: Message[] = [];
    for (let i = 0; i < 10; i++) {
      msgs.push({ role: 'user', content: `q${i}` });
      msgs.push({ role: 'assistant', content: `a${i}` });
    }
    const { toCompress, toKeep } = splitForCompact(msgs, { keepRecentTurns: 3 });
    // 保留最后 3 轮 = 6 条 (q7+a7, q8+a8, q9+a9)
    expect(toKeep.filter(m => m.role === 'user')).toHaveLength(3);
    expect(toCompress).toHaveLength(14); // 前 7 轮 = 14 条
  });
});
