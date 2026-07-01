/**
 * @file 历史压缩（Compact）
 * 当 session messages 的 token 估算接近模型上下文上限时，
 * 自动将旧轮次压缩为摘要，保留最近 N 轮完整消息
 */
import type { Message } from '../types.js';
import type { Provider } from '../provider/types.js';
import { getModelContextSize } from '../provider/model-capabilities.js';

/** Compact 配置 */
export interface CompactOpts {
  /** 上下文 token 上限（默认根据模型自动获取） */
  maxContextTokens?: number;
  /** 触发压缩的阈值比例（默认 0.8，即 80% 时触发） */
  thresholdRatio?: number;
  /** 保留最近 N 轮对话不被压缩（默认 6） */
  keepRecentTurns?: number;
  /** 当前使用的模型名（用于动态获取上下文窗口大小） */
  model?: string;
  /** 摘要压缩使用的模型（默认使用当前模型） */
  compactModel?: string;
}

const DEFAULT_MAX_CONTEXT = 64000;
const DEFAULT_THRESHOLD_RATIO = 0.8;
const DEFAULT_KEEP_RECENT = 6;

/**
 * 估算 messages 的 token 数
 * 中英文分别计算：中文约 1.8 chars/token，英文约 4 chars/token
 */
export function estimateTokens(messages: Message[]): number {
  let totalChars = 0;
  let chineseChars = 0;
  for (const m of messages) {
    if (m.content) {
      totalChars += m.content.length;
      // 统计 CJK 字符
      for (const ch of m.content) {
        const code = ch.charCodeAt(0);
        if (code >= 0x4e00 && code <= 0x9fff) chineseChars++;
      }
    }
    if (m.tool_calls) totalChars += JSON.stringify(m.tool_calls).length;
  }
  // 中文：约 1.8 chars/token；非中文：约 4 chars/token
  const nonChinese = totalChars - chineseChars;
  return Math.ceil(chineseChars / 1.8 + nonChinese / 4);
}

/**
 * 判断是否需要 compact
 * 支持根据模型名自动获取上下文窗口大小
 */
export function needsCompact(messages: Message[], opts: CompactOpts = {}): boolean {
  const max = opts.maxContextTokens ?? (opts.model ? getModelContextSize(opts.model) : DEFAULT_MAX_CONTEXT);
  const ratio = opts.thresholdRatio ?? DEFAULT_THRESHOLD_RATIO;
  return estimateTokens(messages) > max * ratio;
}

/**
 * 将旧轮次消息分成"待压缩"和"保留"两部分
 * - system messages 永远保留
 * - 最近 keepRecentTurns 轮的 user/assistant/tool 消息保留
 * - 其余为待压缩
 */
export function splitForCompact(messages: Message[], opts: CompactOpts = {}): {
  toCompress: Message[];
  toKeep: Message[];
} {
  const keep = opts.keepRecentTurns ?? DEFAULT_KEEP_RECENT;

  // 分离 system messages
  const systemMsgs = messages.filter(m => m.role === 'system');
  const nonSystem = messages.filter(m => m.role !== 'system');

  // 从后往前数 keep 轮（每轮 = 1 个 user + 后续的 assistant/tool）
  let turnsFound = 0;
  let splitIdx = 0; // 默认不压缩任何内容
  for (let i = nonSystem.length - 1; i >= 0; i--) {
    if (nonSystem[i].role === 'user') {
      turnsFound++;
      if (turnsFound >= keep) {
        splitIdx = i;
        break;
      }
    }
  }

  const toCompress = nonSystem.slice(0, splitIdx);
  const toKeep = [...systemMsgs, ...nonSystem.slice(splitIdx)];

  return { toCompress, toKeep };
}

/**
 * 生成摘要的 prompt（发给模型做 summarize）
 */
function buildSummarizePrompt(messages: Message[]): string {
  // 提取关键信息构建摘要输入
  const lines: string[] = [];
  for (const m of messages) {
    if (m.role === 'user' && m.content) {
      lines.push(`用户: ${m.content.slice(0, 200)}`);
    } else if (m.role === 'assistant' && m.content) {
      lines.push(`助手: ${m.content.slice(0, 200)}`);
    } else if (m.role === 'tool' && m.name) {
      lines.push(`工具[${m.name}]: ${m.content?.slice(0, 100) ?? ''}`);
    }
  }
  return lines.join('\n');
}

/**
 * 执行 compact：调用模型生成摘要，替换旧消息
 * 返回压缩后的 messages 数组和摘要内容
 */
export async function compactMessages(
  messages: Message[],
  provider: Provider,
  signal: AbortSignal,
  opts: CompactOpts = {},
): Promise<{ messages: Message[]; summary: string; removedCount: number }> {
  const { toCompress, toKeep } = splitForCompact(messages, opts);

  if (toCompress.length === 0) {
    return { messages, summary: '', removedCount: 0 };
  }

  // 请模型生成摘要
  const conversationText = buildSummarizePrompt(toCompress);
  const summarizeMessages: Message[] = [
    {
      role: 'system',
      content: '你是一个对话摘要助手。请将以下对话历史压缩为一段简洁的摘要，保留关键操作和结果。用中文输出，不超过 500 字。',
    },
    { role: 'user', content: conversationText },
  ];

  let summary = '';
  const summaryModel = opts.compactModel ?? opts.model ?? 'deepseek-v4-flash';
  try {
    for await (const ev of provider.stream(
      { model: summaryModel, messages: summarizeMessages },
      signal,
    )) {
      if (ev.type === 'text_delta') summary += ev.text;
    }
  } catch {
    // 摘要生成失败时，使用简单截断式摘要
    summary = `[历史摘要] 之前的对话包含 ${toCompress.length} 条消息，涉及文件读写和命令执行。`;
  }

  // 构建压缩后的 messages：system + 摘要消息 + 保留的最近轮次
  const compactedMessages: Message[] = [
    ...toKeep.filter(m => m.role === 'system'),
    { role: 'system', content: `[历史摘要]\n${summary}` },
    ...toKeep.filter(m => m.role !== 'system'),
  ];

  return {
    messages: compactedMessages,
    summary,
    removedCount: toCompress.length,
  };
}
