/**
 * @file Skills 安装器测试
 * 测试 local 安装和 manifest 管理（不测 npm/github 需要外部依赖的场景）
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installSkill } from '../../src/skills/installer.js';
import { readManifest, removeEntry } from '../../src/skills/manifest.js';

describe('installSkill - local', () => {
  it('installs a single .md file from local path', async () => {
    const srcDir = mkdtempSync(join(tmpdir(), 'src-'));
    const targetDir = mkdtempSync(join(tmpdir(), 'target-'));
    const skillsTarget = join(targetDir, 'skills');

    writeFileSync(join(srcDir, 'test-skill.md'), '# Test\n\n<!-- trigger: always -->\n\nContent here');

    const result = await installSkill({
      source: join(srcDir, 'test-skill.md'),
      targetDir: skillsTarget,
    });

    expect(result.name).toBe('test-skill');
    expect(result.files).toEqual(['test-skill/test-skill.md']);
    // 文件在子目录中
    expect(existsSync(join(skillsTarget, 'test-skill', 'test-skill.md'))).toBe(true);

    // 验证 manifest 记录
    const manifest = readManifest(skillsTarget);
    expect(manifest['test-skill']).toBeDefined();
    expect(manifest['test-skill'].files).toEqual(['test-skill/test-skill.md']);
    expect(manifest['test-skill'].sourceType).toBe('local');

    rmSync(srcDir, { recursive: true, force: true });
    rmSync(targetDir, { recursive: true, force: true });
  });

  it('installs multiple .md files from a directory', async () => {
    const srcDir = mkdtempSync(join(tmpdir(), 'src-'));
    const targetDir = mkdtempSync(join(tmpdir(), 'target-'));
    const skillsTarget = join(targetDir, 'skills');

    // 创建带 skills/ 子目录的源
    const skillsSrcDir = join(srcDir, 'skills');
    mkdirSync(skillsSrcDir);
    writeFileSync(join(skillsSrcDir, 'a.md'), '# A\n\nContent A');
    writeFileSync(join(skillsSrcDir, 'b.md'), '# B\n\nContent B');
    writeFileSync(join(srcDir, 'README.md'), '# Readme');

    const result = await installSkill({
      source: srcDir,
      targetDir: skillsTarget,
    });

    expect(result.files).toHaveLength(2);
    // 文件在子目录中，路径包含包名前缀
    const name = result.name;
    expect(existsSync(join(skillsTarget, name, 'a.md'))).toBe(true);
    expect(existsSync(join(skillsTarget, name, 'b.md'))).toBe(true);

    rmSync(srcDir, { recursive: true, force: true });
    rmSync(targetDir, { recursive: true, force: true });
  });

  it('installs from directory without skills/ subfolder', async () => {
    const srcDir = mkdtempSync(join(tmpdir(), 'src-'));
    const targetDir = mkdtempSync(join(tmpdir(), 'target-'));
    const skillsTarget = join(targetDir, 'skills');

    writeFileSync(join(srcDir, 'tool.md'), '# Tool\n\nTool content');
    writeFileSync(join(srcDir, 'README.md'), '# Readme should be excluded');

    const result = await installSkill({
      source: srcDir,
      targetDir: skillsTarget,
    });

    // README.md 应被排除，只有 tool.md
    expect(result.files).toHaveLength(1);
    const name = result.name;
    expect(existsSync(join(skillsTarget, name, 'tool.md'))).toBe(true);

    rmSync(srcDir, { recursive: true, force: true });
    rmSync(targetDir, { recursive: true, force: true });
  });
});

describe('manifest management', () => {
  it('removeEntry deletes files and updates manifest', async () => {
    const targetDir = mkdtempSync(join(tmpdir(), 'target-'));
    const srcDir = mkdtempSync(join(tmpdir(), 'src-'));

    writeFileSync(join(srcDir, 'x.md'), '# X\n\nContent');

    // 先安装（文件在 targetDir/x/x.md）
    await installSkill({ source: join(srcDir, 'x.md'), targetDir });
    expect(existsSync(join(targetDir, 'x', 'x.md'))).toBe(true);

    // 再卸载
    const { removed, files } = removeEntry(targetDir, 'x');
    expect(removed).toBe(true);
    expect(files).toEqual(['x/x.md']);
    expect(existsSync(join(targetDir, 'x', 'x.md'))).toBe(false);

    // manifest 应该为空
    const manifest = readManifest(targetDir);
    expect(manifest['x']).toBeUndefined();

    rmSync(targetDir, { recursive: true, force: true });
    rmSync(srcDir, { recursive: true, force: true });
  });

  it('removeEntry returns false for non-existent skill', () => {
    const dir = mkdtempSync(join(tmpdir(), 'target-'));
    const { removed } = removeEntry(dir, 'nonexistent');
    expect(removed).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
});
