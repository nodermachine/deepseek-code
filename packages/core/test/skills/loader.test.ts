/**
 * @file Skills 加载器单元测试
 * 测试 parseSkillFile、loadSkills 的解析和加载逻辑
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSkillFile, loadSkills } from '../../src/skills/loader.js';

describe('parseSkillFile', () => {
  it('parses always-trigger skill', () => {
    const raw = `# 编码规范

<!-- trigger: always -->

- 所有代码必须加注释
- 使用 TypeScript strict 模式
`;
    const skill = parseSkillFile(raw, '/path/to/coding-rules.md');
    expect(skill).not.toBeNull();
    expect(skill!.name).toBe('coding-rules');
    expect(skill!.description).toBe('编码规范');
    expect(skill!.trigger).toEqual({ type: 'always' });
    expect(skill!.content).toContain('所有代码必须加注释');
  });

  it('parses command-trigger skill (default)', () => {
    const raw = `# 代码审查

帮我审查这段代码的质量
`;
    const skill = parseSkillFile(raw, '/path/to/review.md');
    expect(skill!.trigger).toEqual({ type: 'command', name: 'review' });
  });

  it('parses auto-trigger skill with keywords', () => {
    const raw = `# React 组件

<!-- trigger: auto -->
<!-- keywords: react, component, jsx -->

创建 React 组件时遵循以下规范...
`;
    const skill = parseSkillFile(raw, '/skills/react-component.md');
    expect(skill!.trigger).toEqual({ type: 'auto', keywords: ['react', 'component', 'jsx'] });
    expect(skill!.content).toContain('创建 React 组件时遵循以下规范');
  });

  it('returns null for empty content', () => {
    const raw = `# 空技能

<!-- trigger: always -->
`;
    const skill = parseSkillFile(raw, '/skills/empty.md');
    expect(skill).toBeNull();
  });

  it('strips metadata lines from content', () => {
    const raw = `# Test

<!-- trigger: command -->
<!-- keywords: test -->

actual content here
`;
    const skill = parseSkillFile(raw, '/skills/test.md');
    expect(skill!.content).toBe('actual content here');
  });
});

describe('loadSkills', () => {
  it('loads skills from user and project dirs', () => {
    const home = mkdtempSync(join(tmpdir(), 'home-'));
    const cwd = mkdtempSync(join(tmpdir(), 'proj-'));
    const userDir = join(home, '.deepseek-code', 'skills');
    const projDir = join(cwd, '.deepseek-code', 'skills');
    mkdirSync(userDir, { recursive: true });
    mkdirSync(projDir, { recursive: true });

    writeFileSync(join(userDir, 'global.md'), '# 全局规范\n\n<!-- trigger: always -->\n\n全局规则内容');
    writeFileSync(join(projDir, 'local.md'), '# 项目规范\n\n<!-- trigger: command -->\n\n项目特有规则');

    const skills = loadSkills({ cwd, homeDir: home });
    expect(skills).toHaveLength(2);
    expect(skills.find(s => s.name === 'global')).toBeDefined();
    expect(skills.find(s => s.name === 'local')).toBeDefined();

    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  });

  it('project-level overrides user-level for same name', () => {
    const home = mkdtempSync(join(tmpdir(), 'home-'));
    const cwd = mkdtempSync(join(tmpdir(), 'proj-'));
    const userDir = join(home, '.deepseek-code', 'skills');
    const projDir = join(cwd, '.deepseek-code', 'skills');
    mkdirSync(userDir, { recursive: true });
    mkdirSync(projDir, { recursive: true });

    writeFileSync(join(userDir, 'style.md'), '# 用户级\n\n<!-- trigger: always -->\n\n用户级内容');
    writeFileSync(join(projDir, 'style.md'), '# 项目级\n\n<!-- trigger: always -->\n\n项目级内容');

    const skills = loadSkills({ cwd, homeDir: home });
    expect(skills).toHaveLength(1);
    expect(skills[0].description).toBe('项目级');
    expect(skills[0].content).toBe('项目级内容');

    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  });

  it('returns empty array if no skills dirs exist', () => {
    const home = mkdtempSync(join(tmpdir(), 'home-'));
    const cwd = mkdtempSync(join(tmpdir(), 'proj-'));
    const skills = loadSkills({ cwd, homeDir: home });
    expect(skills).toHaveLength(0);
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  });
});
