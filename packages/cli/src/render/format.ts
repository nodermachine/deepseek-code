/**
 * @file 格式化工具
 * 提供工具调用和结果的终端友好显示
 */
import pc from 'picocolors';
import type { ToolResultEnvelope } from '@deepseek-code/core';

/** 提取工具参数的简短摘要（显示在终端） */
function shortArgs(input: unknown): string {
  if (input && typeof input === 'object') {
    const obj = input as Record<string, unknown>;
    if (typeof obj.file_path === 'string') return obj.file_path;
    if (typeof obj.command === 'string') return (obj.command as string).slice(0, 80);
    if (typeof obj.pattern === 'string') return `/${obj.pattern}/`;
  }
  return JSON.stringify(input).slice(0, 80);
}

/** 格式化工具调用开始：“▶ ToolName(args)” */
export function formatToolCallStart(name: string, input: unknown): string {
  return pc.cyan(`▶ ${name}(${shortArgs(input)})`);
}

/** 格式化工具执行结果：“✓ OK” 或 “✗ error” */
export function formatToolResult(env: ToolResultEnvelope): string {
  if (env.ok) return pc.green('  ✓ OK');
  return pc.red(`  ✗ ${env.error}`);
}
