import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadCommands } from '../../src/commands/loader.js';

const TMP = join(tmpdir(), 'deepseek-code-cmd-test');

describe('loadCommands', () => {
  beforeEach(() => {
    rmSync(TMP, { recursive: true, force: true });
    mkdirSync(join(TMP, 'home/.deepseek-code/commands'), { recursive: true });
    mkdirSync(join(TMP, 'proj/.deepseek-code/commands/git'), { recursive: true });
  });
  afterEach(() => rmSync(TMP, { recursive: true, force: true }));

  it('loads project + user commands, project overrides user on name conflict', () => {
    writeFileSync(join(TMP, 'home/.deepseek-code/commands/pr.md'), 'user pr');
    writeFileSync(join(TMP, 'home/.deepseek-code/commands/hello.md'), 'user hello');
    writeFileSync(join(TMP, 'proj/.deepseek-code/commands/pr.md'), 'project pr');
    writeFileSync(join(TMP, 'proj/.deepseek-code/commands/git/pr.md'), 'gitpr');

    const cmds = loadCommands({ cwd: join(TMP, 'proj'), homeDir: join(TMP, 'home') });
    const byName = Object.fromEntries(cmds.map((c) => [c.name, c]));

    expect(byName.pr.source).toBe('project');
    expect(byName.pr.body).toBe('project pr');
    expect(byName.hello.source).toBe('user');
    expect(byName['git:pr'].body).toBe('gitpr');
    expect(byName['git:pr'].source).toBe('project');
  });

  it('returns empty array when no directories exist', () => {
    const cmds = loadCommands({ cwd: join(TMP, 'nowhere'), homeDir: join(TMP, 'nowhere2') });
    expect(cmds).toEqual([]);
  });
});
