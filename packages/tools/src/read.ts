/**
 * @file Read 工具
 * 读取本地文件内容，返回带行号的文本（cat -n 风格）
 * 支持 offset/limit 分页，自动检测二进制文件
 */
import { readFileSync, existsSync, openSync, readSync, closeSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import type { Tool } from '@deepseek-code/core';

const InputSchema = z.object({
  file_path: z.string().refine(isAbsolute, { message: 'file_path must be absolute' }),
  offset: z.number().int().positive().optional(),
  limit: z.number().int().positive().max(10000).optional(),
});

export interface ReadOutput {
  content: string;
  totalLines: number;
  truncated: boolean;
}

const DEFAULT_LIMIT = 2000;

/** 检测文件前 8KB 是否包含 NUL 字节（判断二进制） */
function isBinary(path: string): boolean {
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(8192);
    const n = readSync(fd, buf, 0, buf.length, 0);
    for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
    return false;
  } finally { closeSync(fd); }
}

export const readTool: Tool<z.infer<typeof InputSchema>, ReadOutput> = {
  name: 'Read',
  description: '读取本地文件，返回带行号的内容（cat -n 风格）。file_path 必须是绝对路径。',
  inputSchema: InputSchema,
  needsPermission: () => null,
  async execute(input, ctx) {
    if (!existsSync(input.file_path)) {
      return { ok: false, error: 'file_not_found', recoverable: true };
    }
    if (isBinary(input.file_path)) {
      return { ok: false, error: 'binary_file', recoverable: false };
    }
    const raw = readFileSync(input.file_path, 'utf8');
    const allLines = raw.split('\n');
    if (allLines.length && allLines[allLines.length - 1] === '') allLines.pop();
    const totalLines = allLines.length;
    const offset = input.offset ?? 1;
    const limit = input.limit ?? DEFAULT_LIMIT;
    const startIdx = offset - 1;
    const endIdx = Math.min(startIdx + limit, totalLines);
    const truncated = endIdx < totalLines || startIdx > 0;
    const numbered = allLines.slice(startIdx, endIdx)
      .map((line, i) => `${startIdx + i + 1}\t${line}`)
      .join('\n');
    ctx.session.readFiles.add(input.file_path);
    return { ok: true, output: { content: numbered, totalLines, truncated }, display: numbered };
  },
};
