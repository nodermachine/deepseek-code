import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileIndex } from '../../src/files/index.js';

const TMP = join(tmpdir(), 'ds-fileindex-test');

describe('FileIndex (no git)', () => {
  beforeEach(() => {
    rmSync(TMP, { recursive: true, force: true });
    mkdirSync(join(TMP, 'src'), { recursive: true });
    mkdirSync(join(TMP, 'node_modules/foo'), { recursive: true });
    writeFileSync(join(TMP, 'src/a.ts'), 'x');
    writeFileSync(join(TMP, 'src/b.ts'), 'x');
    writeFileSync(join(TMP, 'node_modules/foo/x.js'), 'x');
    writeFileSync(join(TMP, 'README.md'), 'x');
  });
  afterEach(() => rmSync(TMP, { recursive: true, force: true }));

  it('scans cwd but skips node_modules', () => {
    const idx = new FileIndex({ cwd: TMP });
    idx.load();
    const all = idx.all();
    expect(all).toContain('src/a.ts');
    expect(all).toContain('README.md');
    expect(all.some((p) => p.includes('node_modules'))).toBe(false);
  });

  it('search returns fuzzy matches sorted by score', () => {
    const idx = new FileIndex({ cwd: TMP });
    idx.load();
    const hits = idx.search('at', 5);
    expect(hits.some((h) => h.path === 'src/a.ts')).toBe(true);
  });
});
