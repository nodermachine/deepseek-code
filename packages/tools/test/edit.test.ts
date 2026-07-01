import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { editTool } from '../src/edit.js';
import { readTool } from '../src/read.js';
import { NullLogger } from '@deepseek-code/core';

function ctx(readFiles: Set<string> = new Set()) {
  return { cwd: process.cwd(), signal: new AbortController().signal, logger: new NullLogger(), session: { readFiles } };
}

describe('Edit tool', () => {
  it('replaces unique substring after Read', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'edit-'));
    const f = join(dir, 'a.ts');
    writeFileSync(f, 'const x = 1;\nconst y = 2;\n');
    const c = ctx();
    await readTool.execute({ file_path: f }, c);
    const r = await editTool.execute({ file_path: f, old_string: 'const y = 2;', new_string: 'const y = 99;' }, c);
    expect(r.ok).toBe(true);
    expect(readFileSync(f, 'utf8')).toBe('const x = 1;\nconst y = 99;\n');
    rmSync(dir, { recursive: true, force: true });
  });

  it('errors when file not read in session', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'edit-'));
    const f = join(dir, 'a.ts');
    writeFileSync(f, 'foo');
    const r = await editTool.execute({ file_path: f, old_string: 'foo', new_string: 'bar' }, ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('not_read_in_session');
    rmSync(dir, { recursive: true, force: true });
  });

  it('errors on non-unique old_string', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'edit-'));
    const f = join(dir, 'a.ts');
    writeFileSync(f, 'dup\ndup\n');
    const c = ctx();
    await readTool.execute({ file_path: f }, c);
    const r = await editTool.execute({ file_path: f, old_string: 'dup', new_string: 'one' }, c);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('non_unique_match');
    rmSync(dir, { recursive: true, force: true });
  });

  it('errors when old_string not found', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'edit-'));
    const f = join(dir, 'a.ts');
    writeFileSync(f, 'foo');
    const c = ctx();
    await readTool.execute({ file_path: f }, c);
    const r = await editTool.execute({ file_path: f, old_string: 'bar', new_string: 'baz' }, c);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('old_string_not_found');
    rmSync(dir, { recursive: true, force: true });
  });
});
