/**
 * @file Skills 文件系统加载器
 * 从 ~/.deepseek-code/skills/ 和 <cwd>/.deepseek-code/skills/ 加载 .md 技能文件
 * 解析 HTML 注释中的 trigger/keywords 元数据
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, basename, relative } from 'node:path';
import { homedir } from 'node:os';
import type { Skill, SkillTrigger } from './types.js';

export interface LoadSkillsOpts {
  /** 当前工作目录 */
  cwd: string;
  /** 自定义 home 目录（测试用） */
  homeDir?: string;
}

/**
 * 从文件系统加载所有 skills
 * 加载顺序：用户级 → 项目级（同名时项目级覆盖用户级）
 */
export function loadSkills(opts: LoadSkillsOpts): Skill[] {
  const home = opts.homeDir ?? homedir();
  const skills = new Map<string, Skill>();

  // 用户级 skills
  const userDir = join(home, '.deepseek-code', 'skills');
  loadFromDir(userDir, skills);

  // 项目级 skills（同名覆盖用户级）
  const projectDir = join(opts.cwd, '.deepseek-code', 'skills');
  loadFromDir(projectDir, skills);

  return [...skills.values()];
}

/** 从指定目录递归加载所有 .md 文件为 Skill */
function loadFromDir(dir: string, skills: Map<string, Skill>): void {
  if (!existsSync(dir)) return;
  loadDirRecursive(dir, dir, skills);
}

/**
 * 递归扫描目录加载 .md 文件
 * 用相对于 baseDir 的路径生成唯一 skill name（如 superpowers/brainstorming）
 */
function loadDirRecursive(currentDir: string, baseDir: string, skills: Map<string, Skill>): void {
  const entries = readdirSync(currentDir);
  for (const entry of entries) {
    if (entry.startsWith('.')) continue;
    const fullPath = join(currentDir, entry);
    try {
      const stat = statSync(fullPath);
      if (stat.isFile() && entry.endsWith('.md')) {
        const raw = readFileSync(fullPath, 'utf8');
        // 生成唯一 skill name：
        // - SKILL.md 用父目录名（如 brainstorming）
        // - 其他文件用相对路径（如 brainstorming/visual-companion）
        const relDir = relative(baseDir, currentDir);
        const fileBase = basename(fullPath, '.md');
        let skillName: string;
        if (fileBase.toLowerCase() === 'skill') {
          // SKILL.md → 用父目录名作为 name
          skillName = relDir || fileBase;
        } else {
          skillName = relDir ? `${relDir}/${fileBase}` : fileBase;
        }
        const skill = parseSkillFile(raw, fullPath, skillName);
        if (skill) skills.set(skill.name, skill);
      } else if (stat.isDirectory()) {
        loadDirRecursive(fullPath, baseDir, skills);
      }
    } catch {
      // 跳过解析失败的文件
    }
  }
}

/**
 * 解析单个 Markdown 技能文件
 * 格式约定：
 * ```markdown
 * # 技能标题
 *
 * <!-- trigger: always|command|auto -->
 * <!-- keywords: keyword1, keyword2 -->
 *
 * 正文内容
 * ```
 */
export function parseSkillFile(raw: string, filePath: string, nameOverride?: string): Skill | null {
  const lines = raw.split('\n');

  // 提取标题（第一个 # 开头的行）
  const titleLine = lines.find(l => l.startsWith('# '));
  const description = titleLine ? titleLine.slice(2).trim() : basename(filePath, '.md');
  // 使用 nameOverride（相对路径）或文件名作为 skill name
  const name = nameOverride ?? basename(filePath, '.md');

  // 解析元数据注释
  const trigger = parseTrigger(raw, name);

  // 正文：去除 # 标题行和 <!-- ... --> 元数据行
  const contentLines = lines.filter(l => {
    if (l.startsWith('# ') && l === titleLine) return false;
    if (/^\s*<!--\s*(trigger|keywords)\s*:/.test(l)) return false;
    return true;
  });
  const content = contentLines.join('\n').trim();

  if (!content) return null;

  return { name, description, trigger, content, filePath };
}

/**
 * 从 Markdown 中解析触发器元数据
 * 支持格式：<!-- trigger: always --> 或 <!-- trigger: command --> 或 <!-- trigger: auto -->
 */
function parseTrigger(raw: string, name: string): SkillTrigger {
  // 匹配 <!-- trigger: xxx -->
  const triggerMatch = raw.match(/<!--\s*trigger\s*:\s*(\w+)\s*-->/);
  const triggerType = triggerMatch?.[1]?.toLowerCase() ?? 'command';

  switch (triggerType) {
    case 'always':
      return { type: 'always' };
    case 'auto': {
      // 解析 keywords
      const kwMatch = raw.match(/<!--\s*keywords\s*:\s*(.+?)\s*-->/);
      const keywords = kwMatch
        ? kwMatch[1].split(',').map(k => k.trim()).filter(Boolean)
        : [name];
      return { type: 'auto', keywords };
    }
    case 'command':
    default:
      return { type: 'command', name };
  }
}
