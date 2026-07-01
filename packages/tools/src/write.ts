/**
 * @file Write 工具
 * 向文件写入完整内容（覆盖）。已存在的文件必须先 Read 过，新文件允许直接写
 */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { z } from 'zod';
import type { Tool } from '@deepseek-code/core';

const InputSchema = z.object({
  file_path: z.string().refine(isAbsolute, { message: 'file_path must be absolute' }),
  content: z.string(),
});

export interface WriteOutput {
  path: string;
  bytes_written: number;
}

export const writeTool: Tool<z.infer<typeof InputSchema>, WriteOutput> = {
  name: 'Write',
  description: '向文件写入完整内容（覆盖）。已存在的文件必须先用 Read 读取过。',
  inputSchema: InputSchema,
  needsPermission: (input) => ({ tool: 'Write', matcher: input.file_path, summary: input.file_path }),
  async execute(input, ctx) {
    if (existsSync(input.file_path) && !ctx.session.readFiles.has(input.file_path)) {
      return { ok: false, error: 'not_read_in_session', recoverable: true };
    }
    mkdirSync(dirname(input.file_path), { recursive: true });
    writeFileSync(input.file_path, input.content);
    ctx.session.readFiles.add(input.file_path);
    return { ok: true, output: { path: input.file_path, bytes_written: Buffer.byteLength(input.content, 'utf8') }, display: `已写入 ${input.file_path}` };
  },
};
