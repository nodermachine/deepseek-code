import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { appendMemory } from '../../src/memory/appender.js';

const TMP = join(tmpdir(), 'ds-mem-test');

describe('appendMemory', () => {
  beforeEach(() => {
    rmSync(TMP, { recursive: true, force: true });
    mkdirSync(join(TMP, 'home/.deepseek-code'), { recursive: true });
    mkdirSync(join(TMP, 'proj'), { recursive: true });
  });
  afterEach(() => rmSync(TMP, { recursive: true, force: true }));

  it('creates project DEEPSEEK.md if missing', () => {
    const r = appendMemory({
      scope: 'project', text: 'no mocks', cwd: join(TMP, 'proj'), homeDir: join(TMP, 'home'),
    });
    expect(r.created).toBe(true);
    expect(existsSync(r.filePath)).toBe(true);
    expect(readFileSync(r.filePath, 'utf8')).toContain('no mocks');
  });

  it('appends to existing project file', () => {
    const p = join(TMP, 'proj/DEEPSEEK.md');
    writeFileSync(p, '# Existing\n\n- rule 1\n');
    const r = appendMemory({
      scope: 'project', text: 'rule 2', cwd: join(TMP, 'proj'), homeDir: join(TMP, 'home'),
    });
    expect(r.created).toBe(false);
    const content = readFileSync(p, 'utf8');
    expect(content).toContain('rule 1');
    expect(content).toContain('rule 2');
  });

  it('user scope writes to homeDir', () => {
    const r = appendMemory({
      scope: 'user', text: 'global', cwd: join(TMP, 'proj'), homeDir: join(TMP, 'home'),
    });
    expect(r.filePath).toBe(join(TMP, 'home/.deepseek-code/DEEPSEEK.md'));
    expect(readFileSync(r.filePath, 'utf8')).toContain('global');
  });
});
