/**
 * @file 流式渲染器（纯文本模式）
 * 将 AgentEvent 流渲染到终端，assistant 文本完成后用 Markdown 渲染输出
 *
 * 设计原则：
 * - 所有输出只追加，不擦除（不使用 ANSI 光标上移/清行转义码）
 * - 避免破坏终端滚动缓冲区（scrollback buffer），确保用户可以向上滚动查看输出
 */
import pc from 'picocolors';
import { Marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import type { AgentEvent } from '@deepseek-code/core';
import { formatToolCallStart, formatToolResult } from './format.js';

// 配置 marked-terminal 将 Markdown 渲染为终端带颜色输出
const marked = new Marked(markedTerminal() as any);

/** 将 Markdown 渲染为终端格式化字符串 */
function renderMarkdown(md: string): string {
  try {
    return (marked.parse(md) as string).trimEnd();
  } catch {
    return md;
  }
}

export async function renderAgentStream(
  events: AsyncIterable<AgentEvent>,
  out: NodeJS.WritableStream,
): Promise<{ exitCode: number }> {
  let exitCode = 0;
  let textBuffer = '';   // 累积 assistant 文本，结束后统一渲染
  let inThinking = false;

  for await (const ev of events) {
    if (ev.type === 'text_delta') {
      if (inThinking) { out.write('\n'); inThinking = false; }
      textBuffer += ev.text;
      // 不输出原始文本——等完成时一次渲染为 Markdown，
      // 避免后续用 ANSI 擦除重绘破坏终端滚动缓冲区
      continue;
    }
    if (ev.type === 'thinking_delta') {
      // 思考内容前：flush 已有文本
      if (textBuffer) {
        out.write(renderMarkdown(textBuffer) + '\n');
        textBuffer = '';
      }
      if (!inThinking) {
        out.write(pc.gray('[思考] '));
        inThinking = true;
      }
      out.write(pc.gray(ev.text));
      continue;
    }
    // 其他事件前：flush 文本 + 收束思考
    if (inThinking) { out.write('\n'); inThinking = false; }
    if (textBuffer) {
      out.write(renderMarkdown(textBuffer) + '\n');
      textBuffer = '';
    }
    switch (ev.type) {
      case 'tool_call_start':
        out.write(formatToolCallStart(ev.name, ev.input) + '\n');
        break;
      case 'tool_call_result':
        out.write(formatToolResult(ev.result) + '\n');
        break;
      case 'error':
        out.write(pc.red(`! ${ev.error.code}: ${ev.error.userMessage}\n`));
        break;
      case 'done':
        if (ev.reason === 'fatal' || ev.reason === 'max_steps') exitCode = 1;
        if (ev.reason === 'abort') exitCode = 130;
        break;
    }
  }
  // 最后 flush 剩余文本
  if (textBuffer) {
    out.write(renderMarkdown(textBuffer) + '\n');
  }
  return { exitCode };
}
