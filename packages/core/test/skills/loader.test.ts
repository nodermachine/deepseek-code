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

describe('parseSkillFile - YAML frontmatter (Anthropic/skills.sh standard)', () => {
  it('parses YAML frontmatter with name, description, no explicit trigger', () => {
    const raw = `---
name: web-fetch
description: 用无头浏览器抓取网页正文
---

# 联网抓取

正文内容
`;
    const skill = parseSkillFile(raw, '/path/to/web-fetch.md');
    expect(skill).not.toBeNull();
    expect(skill!.name).toBe('web-fetch');
    expect(skill!.description).toBe('用无头浏览器抓取网页正文');
    expect(skill!.trigger).toEqual({ type: 'command', name: 'web-fetch' });
    expect(skill!.content).not.toContain('---');
    expect(skill!.content).not.toContain('name: web-fetch');
    expect(skill!.content).toContain('正文内容');
  });

  it('parses YAML frontmatter with explicit trigger: auto and keywords', () => {
    const raw = `---
name: find-skills
description: Find and install skills
trigger: auto
keywords: find skill, install skill, is there a skill
---

# Find Skills

body
`;
    const skill = parseSkillFile(raw, '/path/to/find-skills/SKILL.md', 'find-skills');
    expect(skill!.name).toBe('find-skills');
    expect(skill!.description).toBe('Find and install skills');
    expect(skill!.trigger).toEqual({
      type: 'auto',
      keywords: ['find skill', 'install skill', 'is there a skill'],
    });
  });

  it('YAML trigger: always works too', () => {
    const raw = `---
name: p9
description: think like a P9
trigger: always
---

# P9

body
`;
    const skill = parseSkillFile(raw, '/path/to/p9/SKILL.md', 'p9');
    expect(skill!.trigger).toEqual({ type: 'always' });
  });

  it('YAML description overrides H1 heading', () => {
    const raw = `---
description: The official description
---

# Different H1 title

body
`;
    const skill = parseSkillFile(raw, '/x/s.md');
    expect(skill!.description).toBe('The official description');
  });

  it('YAML keywords accepts array form too', () => {
    const raw = `---
trigger: auto
keywords: [alpha, beta, gamma]
---

# T
body
`;
    const skill = parseSkillFile(raw, '/x/s.md');
    expect(skill!.trigger).toEqual({ type: 'auto', keywords: ['alpha', 'beta', 'gamma'] });
  });

  it('frontmatter block is stripped from content', () => {
    const raw = `---
name: x
description: y
---

# Title

meaningful body
`;
    const skill = parseSkillFile(raw, '/x/s.md');
    expect(skill!.content.startsWith('---')).toBe(false);
    expect(skill!.content).toContain('meaningful body');
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

  it('treats a subdirectory with SKILL.md as one skill and ignores its other .md files', () => {
    const home = mkdtempSync(join(tmpdir(), 'home-'));
    const cwd = mkdtempSync(join(tmpdir(), 'proj-'));
    const userDir = join(home, '.deepseek-code', 'skills');
    const p9Dir = join(userDir, 'p9');
    const refsDir = join(p9Dir, 'references');
    const testsDir = join(p9Dir, 'tests');
    mkdirSync(refsDir, { recursive: true });
    mkdirSync(testsDir, { recursive: true });

    writeFileSync(
      join(p9Dir, 'SKILL.md'),
      `---\nname: p9\ndescription: think like a P9\ntrigger: command\n---\n\n# P9\n\nbody`,
    );
    // Reference files must NOT be loaded as separate skills
    writeFileSync(join(refsDir, 'mental-model.md'), '# 心智模型\n\n参考材料');
    writeFileSync(join(refsDir, 'templates.md'), '# 模板\n\n模板内容');
    writeFileSync(join(testsDir, 'README.md'), '# 测试说明\n\n测试文档');

    const skills = loadSkills({ cwd, homeDir: home });
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('p9');
    expect(skills.find(s => s.name.includes('mental-model'))).toBeUndefined();
    expect(skills.find(s => s.name.includes('templates'))).toBeUndefined();
    expect(skills.find(s => s.name.includes('README'))).toBeUndefined();

    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  });

  it('flat <name>.md file (no SKILL.md inside a dir) still loads', () => {
    const home = mkdtempSync(join(tmpdir(), 'home-'));
    const cwd = mkdtempSync(join(tmpdir(), 'proj-'));
    const userDir = join(home, '.deepseek-code', 'skills');
    mkdirSync(userDir, { recursive: true });

    writeFileSync(
      join(userDir, 'quick-tip.md'),
      `---\ndescription: quick tip\n---\n\n# tip\n\nbody`,
    );
    const skills = loadSkills({ cwd, homeDir: home });
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('quick-tip');

    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  });

  it('multiple SKILL.md siblings coexist (each in own dir)', () => {
    const home = mkdtempSync(join(tmpdir(), 'home-'));
    const cwd = mkdtempSync(join(tmpdir(), 'proj-'));
    const userDir = join(home, '.deepseek-code', 'skills');
    mkdirSync(join(userDir, 'a'), { recursive: true });
    mkdirSync(join(userDir, 'b'), { recursive: true });
    writeFileSync(join(userDir, 'a', 'SKILL.md'), '---\ndescription: A\n---\n\nbody a');
    writeFileSync(join(userDir, 'b', 'SKILL.md'), '---\ndescription: B\n---\n\nbody b');

    const skills = loadSkills({ cwd, homeDir: home });
    expect(skills.map(s => s.name).sort()).toEqual(['a', 'b']);

    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  });
});
