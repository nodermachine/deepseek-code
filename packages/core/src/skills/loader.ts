/**
 * @file Skills 文件系统加载器
 *
 * 从 ~/.deepseek-code/skills/ 和 <cwd>/.deepseek-code/skills/ 加载 skill。
 *
 * 一个 skill = 一个 `SKILL.md` 文件（在其独立目录下），或直接一个 `<name>.md` 文件。
 * 如果目录里有 `SKILL.md`，则该目录整体算一个 skill，其余 `.md` 文件视为参考材料忽略。
 *
 * 元数据格式（对齐 Anthropic / skills.sh 生态）：
 *   1. YAML frontmatter（首选）：
 *      ---
 *      name: ...
 *      description: ...
 *      trigger: always | command | auto
 *      keywords: kw1, kw2   或   [kw1, kw2]
 *      ---
 *   2. 向后兼容：HTML 注释 `<!-- trigger: xxx -->` / `<!-- keywords: ... -->`
 *
 * 若两种都有，YAML 优先。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, basename, relative } from 'node:path';
import { homedir } from 'node:os';
import type { Skill, SkillTrigger } from './types.js';

export interface LoadSkillsOpts {
  cwd: string;
  homeDir?: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * 从文件系统加载所有 skills。用户级 → 项目级；同名时项目级覆盖。
 */
export function loadSkills(opts: LoadSkillsOpts): Skill[] {
  const home = opts.homeDir ?? homedir();
  const skills = new Map<string, Skill>();

  const userDir = join(home, '.deepseek-code', 'skills');
  loadFromDir(userDir, skills);

  const projectDir = join(opts.cwd, '.deepseek-code', 'skills');
  loadFromDir(projectDir, skills);

  return [...skills.values()];
}

function loadFromDir(dir: string, skills: Map<string, Skill>): void {
  if (!existsSync(dir)) return;
  walkAsSkillTree(dir, dir, skills);
}

/**
 * 递归扫描目录：
 * - 当前目录若有 `SKILL.md`：视为整目录是一个 skill，不再递归。
 * - 否则：目录里的 `<name>.md` 各自算 skill；子目录继续递归。
 *
 * `.installed.json`、`.` 开头的隐藏文件全部跳过。
 */
function walkAsSkillTree(currentDir: string, baseDir: string, skills: Map<string, Skill>): void {
  let entries: string[];
  try { entries = readdirSync(currentDir); } catch { return; }

  const hasSkillMd = entries.some((e) => e.toUpperCase() === 'SKILL.MD');
  if (hasSkillMd) {
    const skillPath = join(currentDir, entries.find((e) => e.toUpperCase() === 'SKILL.MD')!);
    const relDir = relative(baseDir, currentDir);
    const skillName = relDir || basename(currentDir);
    const raw = safeRead(skillPath);
    if (raw !== null) {
      const s = parseSkillFile(raw, skillPath, skillName);
      if (s) skills.set(s.name, s);
    }
    return; // 不再深入递归；references / tests / 子目录都是本 skill 的支持材料
  }

  for (const entry of entries) {
    if (entry.startsWith('.')) continue;
    const full = join(currentDir, entry);
    let stat;
    try { stat = statSync(full); } catch { continue; }

    if (stat.isFile() && entry.toLowerCase().endsWith('.md')) {
      const raw = safeRead(full);
      if (raw === null) continue;
      const relDir = relative(baseDir, currentDir);
      const fileBase = basename(entry, '.md');
      const skillName = relDir ? `${relDir}/${fileBase}` : fileBase;
      const s = parseSkillFile(raw, full, skillName);
      if (s) skills.set(s.name, s);
    } else if (stat.isDirectory()) {
      walkAsSkillTree(full, baseDir, skills);
    }
  }
}

function safeRead(path: string): string | null {
  try { return readFileSync(path, 'utf8'); } catch { return null; }
}

/**
 * 解析单个 Markdown skill 文件。
 * `nameOverride` 用于让上层控制 name（避免 SKILL.md 全叫 "SKILL"）。
 */
export function parseSkillFile(raw: string, filePath: string, nameOverride?: string): Skill | null {
  // 1) YAML frontmatter
  const fmMatch = raw.match(FRONTMATTER_RE);
  const fm = fmMatch ? parseYamlLite(fmMatch[1]) : {};
  const body = fmMatch ? raw.slice(fmMatch[0].length) : raw;

  const lines = body.split('\n');
  const titleLine = lines.find((l) => l.startsWith('# '));

  const fallbackName =
    nameOverride ?? basename(filePath, '.md');
  const name = typeof fm.name === 'string' && fm.name.trim() ? fm.name.trim() : fallbackName;

  const description = typeof fm.description === 'string' && fm.description.trim()
    ? fm.description.trim()
    : titleLine
      ? titleLine.slice(2).trim()
      : name;

  const trigger = resolveTrigger(fm, body, name);

  // 2) 剥去 H1 与 HTML 元注释
  const bodyLines = lines.filter((l) => {
    if (l.startsWith('# ') && l === titleLine) return false;
    if (/^\s*<!--\s*(trigger|keywords)\s*:/i.test(l)) return false;
    return true;
  });
  const content = bodyLines.join('\n').trim();
  if (!content) return null;

  return { name, description, trigger, content, filePath };
}

/**
 * 极简 YAML 解析：只支持 `key: value` 与数组字面量 `[a, b]`。
 * 值是纯字符串；数组解析成 string[]；其它一律当字符串保留原样。
 */
function parseYamlLite(src: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const rawLine of src.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const rest = line.slice(idx + 1).trim();
    if (!rest) { out[key] = ''; continue; }
    if (rest.startsWith('[') && rest.endsWith(']')) {
      out[key] = rest.slice(1, -1).split(',').map((s) => stripQuotes(s.trim())).filter(Boolean);
    } else {
      out[key] = stripQuotes(rest);
    }
  }
  return out;
}

function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

/**
 * 触发器解析优先级：YAML frontmatter > HTML 注释 > 默认 command。
 */
function resolveTrigger(
  fm: Record<string, string | string[]>,
  body: string,
  name: string,
): SkillTrigger {
  const yamlTrigger =
    typeof fm.trigger === 'string' ? fm.trigger.toLowerCase().trim() : '';
  const htmlMatch = body.match(/<!--\s*trigger\s*:\s*(\w+)\s*-->/i);
  const htmlTrigger = htmlMatch ? htmlMatch[1].toLowerCase() : '';
  const triggerType = yamlTrigger || htmlTrigger || 'command';

  switch (triggerType) {
    case 'always':
      return { type: 'always' };
    case 'auto': {
      const keywords = extractKeywords(fm, body, name);
      return { type: 'auto', keywords };
    }
    case 'globs': {
      const patterns = extractGlobs(fm);
      return patterns.length > 0 ? { type: 'globs', patterns } : { type: 'command', name };
    }
    case 'command':
    default:
      // 即使 trigger 不是 globs，如果 frontmatter 中有 globs 字段，也尝试解析为 globs 类型
      const fallbackGlobs = extractGlobs(fm);
      if (fallbackGlobs.length > 0) return { type: 'globs', patterns: fallbackGlobs };
      return { type: 'command', name };
  }
}

function extractKeywords(
  fm: Record<string, string | string[]>,
  body: string,
  name: string,
): string[] {
  if (Array.isArray(fm.keywords)) {
    const arr = fm.keywords.filter((k) => typeof k === 'string' && k.trim().length > 0);
    if (arr.length) return arr;
  }
  if (typeof fm.keywords === 'string' && fm.keywords.trim()) {
    return fm.keywords.split(',').map((k) => k.trim()).filter(Boolean);
  }
  const htmlKw = body.match(/<!--\s*keywords\s*:\s*(.+?)\s*-->/i);
  if (htmlKw) {
    return htmlKw[1].split(',').map((k) => k.trim()).filter(Boolean);
  }
  return [name];
}

/** 从 frontmatter 提取 globs 字段（支持数组和逗号分隔字符串） */
function extractGlobs(fm: Record<string, string | string[]>): string[] {
  if (Array.isArray(fm.globs)) {
    return fm.globs.filter((g) => typeof g === 'string' && g.trim().length > 0);
  }
  if (typeof fm.globs === 'string' && fm.globs.trim()) {
    return fm.globs.split(',').map((g) => g.trim()).filter(Boolean);
  }
  return [];
}
