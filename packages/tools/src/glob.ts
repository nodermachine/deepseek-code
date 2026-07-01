/**
 * @file Glob 工具
 * 使用 fast-glob 在指定目录下按模式匹配文件路径
 * 最多返回 200 条结果，自动忽略 node_modules 和 .git
 */
import fg from 'fast-glob';
import { z } from 'zod';
import type { Tool } from '@deepseek-code/core';

const InputSchema = z.object({
  pattern: z.string().min(1),
  cwd: z.string().optional(),
});

export interface GlobOutput {
  files: string[];
  truncated: boolean;
}

const MAX_RESULTS = 200;

export const globTool: Tool<z.infer<typeof InputSchema>, GlobOutput> = {
  name: 'Glob',
  description: '按 glob 模式搜索文件路径（如 **/*.ts），返回匹配的文件列表。自动忽略 node_modules 和 .git。',
  inputSchema: InputSchema,
  needsPermission: () => null,
  async execute(input, ctx) {
    const cwd = input.cwd ?? ctx.cwd;
    try {
      const files = await fg(input.pattern, {
        cwd,
        ignore: ['**/node_modules/**', '**/.git/**'],
        onlyFiles: true,
        absolute: false,
        followSymbolicLinks: false,
      });
      const truncated = files.length > MAX_RESULTS;
      const result = truncated ? files.slice(0, MAX_RESULTS) : files;
      return {
        ok: true,
        output: { files: result, truncated },
        display: result.join('\n') || '(无匹配)',
      };
    } catch (e: any) {
      return { ok: false, error: e.message ?? 'glob_failed', recoverable: true };
    }
  },
};
