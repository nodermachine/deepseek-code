import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadMemory, buildSystemPrompt } from '../../src/memory/loader.js';

function mkDir(): string {
  return mkdtempSync(join(tmpdir(), 'mem-'));
}

describe('loadMemory', () => {
  it('returns null when no DEEPSEEK.md exists', () => {
    const cwd = mkDir();
    const home = mkDir();
    expect(loadMemory({ cwd, homeDir: home })).toBeNull();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  it('loads user-level DEEPSEEK.md', () => {
    const cwd = mkDir();
    const home = mkDir();
    mkdirSync(join(home, '.deepseek-code'));
    writeFileSync(join(home, '.deepseek-code', 'DEEPSEEK.md'), '# User Rules\nAlways use English');
    const result = loadMemory({ cwd, homeDir: home });
    expect(result).toContain('User Rules');
    expect(result).toContain('Always use English');
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  it('loads project-level DEEPSEEK.md from cwd root', () => {
    const cwd = mkDir();
    const home = mkDir();
    writeFileSync(join(cwd, 'DEEPSEEK.md'), '# Project\nThis is a TypeScript project');
    const result = loadMemory({ cwd, homeDir: home });
    expect(result).toContain('TypeScript project');
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  it('loads project-level from .deepseek-code/ subfolder', () => {
    const cwd = mkDir();
    const home = mkDir();
    mkdirSync(join(cwd, '.deepseek-code'));
    writeFileSync(join(cwd, '.deepseek-code', 'DEEPSEEK.md'), '# Hidden Config');
    const result = loadMemory({ cwd, homeDir: home });
    expect(result).toContain('Hidden Config');
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  it('merges user + project level with separator', () => {
    const cwd = mkDir();
    const home = mkDir();
    mkdirSync(join(home, '.deepseek-code'));
    writeFileSync(join(home, '.deepseek-code', 'DEEPSEEK.md'), 'User memo');
    writeFileSync(join(cwd, 'DEEPSEEK.md'), 'Project memo');
    const result = loadMemory({ cwd, homeDir: home });
    expect(result).toContain('User memo');
    expect(result).toContain('Project memo');
    expect(result).toContain('---'); // separator
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });
});

describe('buildSystemPrompt', () => {
  it('includes cwd in base prompt even without DEEPSEEK.md', () => {
    const cwd = mkDir();
    const home = mkDir();
    const prompt = buildSystemPrompt({ cwd, homeDir: home });
    expect(prompt).toContain(cwd);
    expect(prompt).toContain('deepseek-code');
    expect(prompt).toContain('Read');
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  it('appends DEEPSEEK.md content when present', () => {
    const cwd = mkDir();
    const home = mkDir();
    writeFileSync(join(cwd, 'DEEPSEEK.md'), '# Custom Instructions\nUse pnpm');
    const prompt = buildSystemPrompt({ cwd, homeDir: home });
    expect(prompt).toContain('Custom Instructions');
    expect(prompt).toContain('Use pnpm');
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });
});
