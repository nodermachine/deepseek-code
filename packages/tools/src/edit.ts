/**
 * @file Edit 工具
 * 精确字符串替换：要求 old_string 在文件中唯一出现，且文件已在本 session 中被 Read 过
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import type { Tool } from '@deepseek-code/core';

const InputSchema = z.object({
  file_path: z.string().refine(isAbsolute, { message: 'file_path must be absolute' }),
  old_string: z.string(),
  new_string: z.string(),
});

export interface EditOutput {
  path: string;
  replaced: 1;
}

export const editTool: Tool<z.infer<typeof InputSchema>, EditOutput> = {
  name: 'Edit',
  description: '在文件中将 old_string 精确替换为 new_string。old_string 必须在文件中唯一出现。修改前必须先用 Read 读取该文件。',
  inputSchema: InputSchema,
  needsPermission: (input) => ({ tool: 'Edit', matcher: input.file_path, summary: input.file_path }),
  async execute(input, ctx) {
    if (input.old_string === input.new_string) {
      return { ok: false, error: 'identical_strings', recoverable: false };
    }
    if (!existsSync(input.file_path)) {
      return { ok: false, error: 'file_not_found', recoverable: true };
    }
    if (!ctx.session.readFiles.has(input.file_path)) {
      return { ok: false, error: 'not_read_in_session', recoverable: true };
    }
    const content = readFileSync(input.file_path, 'utf8');
    const occurrences = content.split(input.old_string).length - 1;
    if (occurrences === 0) {
      return { ok: false, error: 'old_string_not_found', recoverable: true };
    }
    if (occurrences > 1) {
      return { ok: false, error: 'non_unique_match', recoverable: true };
    }
    writeFileSync(input.file_path, content.replace(input.old_string, input.new_string));
    ctx.session.readFiles.add(input.file_path);
    return { ok: true, output: { path: input.file_path, replaced: 1 }, display: `已替换 ${input.file_path}` };
  },
};
