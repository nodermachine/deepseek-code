/**
 * @file MultiEdit 工具
 * 批量多文件 search-replace 编辑，原子性执行（任何一处失败则全部不写入）
 * 对标 Claude Code 的多文件编辑能力
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { z } from 'zod';
import type { Tool } from '@deepseek-code/core';

const SingleEdit = z.object({
  file_path: z.string(),
  old_string: z.string(),
  new_string: z.string(),
});

const InputSchema = z.object({
  edits: z.array(SingleEdit).min(1).max(20),
});

export interface MultiEditOutput {
  applied: number;
  files: string[];
}

export const multiEditTool: Tool<z.infer<typeof InputSchema>, MultiEditOutput> = {
  name: 'MultiEdit',
  description: '批量多文件编辑：接受多组 {file_path, old_string, new_string}，原子性执行。任何一处 old_string 找不到则全部不写入。',
  inputSchema: InputSchema,
  needsPermission: (input) => ({
    tool: 'MultiEdit',
    matcher: input.edits.map(e => e.file_path).join(', '),
    summary: `编辑 ${input.edits.length} 个位置 (${[...new Set(input.edits.map(e => e.file_path))].join(', ')})`,
  }),
  async execute(input, ctx) {
    // 阶段一：验证所有 edit 的前置条件
    const patches: Array<{ path: string; content: string }> = [];

    for (let i = 0; i < input.edits.length; i++) {
      const edit = input.edits[i];
      if (!existsSync(edit.file_path)) {
        return { ok: false, error: `file_not_found: ${edit.file_path} (edit #${i + 1})`, recoverable: true };
      }
      if (!ctx.session.readFiles.has(edit.file_path)) {
        return { ok: false, error: `not_read_in_session: ${edit.file_path} (edit #${i + 1})`, recoverable: true };
      }
      if (edit.old_string === edit.new_string) {
        return { ok: false, error: `identical_strings in edit #${i + 1}`, recoverable: false };
      }
    }

    // 阶段二：读取文件并验证 old_string 存在
    const fileContents = new Map<string, string>();
    for (const edit of input.edits) {
      if (!fileContents.has(edit.file_path)) {
        fileContents.set(edit.file_path, readFileSync(edit.file_path, 'utf8'));
      }
    }

    // 按文件分组，依次应用 edits（同文件多个 edit 按顺序）
    const resultContents = new Map<string, string>(fileContents);
    for (let i = 0; i < input.edits.length; i++) {
      const edit = input.edits[i];
      const current = resultContents.get(edit.file_path)!;
      if (!current.includes(edit.old_string)) {
        return { ok: false, error: `old_string_not_found in ${edit.file_path} (edit #${i + 1})`, recoverable: true };
      }
      // 只替换第一次出现
      resultContents.set(edit.file_path, current.replace(edit.old_string, edit.new_string));
    }

    // 阶段三：全部验证通过，原子写入
    const touchedFiles = new Set<string>();
    for (const [path, content] of resultContents) {
      if (content !== fileContents.get(path)) {
        writeFileSync(path, content);
        touchedFiles.add(path);
      }
    }

    return {
      ok: true,
      output: { applied: input.edits.length, files: [...touchedFiles] },
      display: `✓ ${input.edits.length} edits applied to ${touchedFiles.size} file(s)`,
    };
  },
};
