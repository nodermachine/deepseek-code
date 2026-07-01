import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readTool } from '../src/read.js';
import { NullLogger } from '@deepseek-code/core';

function ctx() {
  return { cwd: process.cwd(), signal: new AbortController().signal, logger: new NullLogger(), session: { readFiles: new Set<string>() } };
}

describe('Read tool', () => {
  it('reads a small file with line numbers', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'read-'));
    const f = join(dir, 'a.txt');
    writeFileSync(f, 'line1\nline2\nline3\n');
    const r = await readTool.execute({ file_path: f }, ctx());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.output.content).toBe('1\tline1\n2\tline2\n3\tline3');
      expect(r.output.totalLines).toBe(3);
      expect(r.output.truncated).toBe(false);
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('applies offset and limit', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'read-'));
    const f = join(dir, 'a.txt');
    writeFileSync(f, [1,2,3,4,5].map(n => `L${n}`).join('\n'));
    const r = await readTool.execute({ file_path: f, offset: 2, limit: 2 }, ctx());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.output.content).toBe('2\tL2\n3\tL3');
    rmSync(dir, { recursive: true, force: true });
  });

  it('rejects binary file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'read-'));
    const f = join(dir, 'b.bin');
    writeFileSync(f, Buffer.from([0x00, 0x01, 0x02]));
    const r = await readTool.execute({ file_path: f }, ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('binary_file');
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns file_not_found for missing file', async () => {
    const r = await readTool.execute({ file_path: '/nonexistent/zzz.txt' }, ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('file_not_found');
  });

  it('rejects relative path via schema', () => {
    const parsed = readTool.inputSchema.safeParse({ file_path: 'rel/path.txt' });
    expect(parsed.success).toBe(false);
  });
});
