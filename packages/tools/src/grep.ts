/**
 * @file Grep 工具
 * 包装 ripgrep (rg) 进行正则搜索，支持 glob、大小写不敏感、上下文行数
 */
import { spawnSync } from 'node:child_process';
import { z } from 'zod';
import type { Tool } from '@deepseek-code/core';

const InputSchema = z.object({
  pattern: z.string().min(1),
  path: z.string().optional(),
  glob: z.string().optional(),
  case_insensitive: z.boolean().optional(),
  show_line_numbers: z.boolean().optional(),
  context: z.number().int().min(0).max(20).optional(),
});

export interface GrepOutput {
  matches: string;
  truncated: boolean;
}

const MAX_BYTES = 1024 * 256;

export const grepTool: Tool<z.infer<typeof InputSchema>, GrepOutput> = {
  name: 'Grep',
  description: '使用 ripgrep 在文件/目录中搜索正则模式，返回匹配行。',
  inputSchema: InputSchema,
  needsPermission: () => null,
  async execute(input, ctx) {
    const args: string[] = [];
    if (input.case_insensitive) args.push('-i');
    if (input.show_line_numbers) args.push('-n');
    if (typeof input.context === 'number') args.push('-C', String(input.context));
    if (input.glob) args.push('-g', input.glob);
    args.push('--', input.pattern);
    if (input.path) args.push(input.path);
    const res = spawnSync('rg', args, { cwd: ctx.cwd, encoding: 'utf8', maxBuffer: MAX_BYTES });
    if (res.error && (res.error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ok: false, error: 'ripgrep not installed. Install with: `brew install ripgrep` (macOS) or `apt install ripgrep` (Linux). As alternative, use Bash with find/grep.', recoverable: false };
    }
    if (res.status !== 0 && res.status !== 1) {
      return { ok: false, error: `rg exited ${res.status}: ${res.stderr}`, recoverable: true };
    }
    const out = res.stdout ?? '';
    return { ok: true, output: { matches: out.trim(), truncated: out.length >= MAX_BYTES }, display: out };
  },
};
