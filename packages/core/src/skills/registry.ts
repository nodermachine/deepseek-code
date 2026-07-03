/**
 * @file Skills 注册表
 * 管理已加载的 Skills，提供按触发类型查询的 API
 */
import type { Skill } from './types.js';
import { loadSkills, type LoadSkillsOpts } from './loader.js';
import { getBuiltinSkills } from './builtin.js';

/**
 * 简单 glob 匹配：支持 ** 和 *
 * - '**' 匹配任意层级目录
 * - '*' 匹配单层目录内的任意字符
 */
function matchGlobSimple(pattern: string, filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  const regexStr = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '\x01')
    .replace(/\*/g, '[^/]*')
    .replace(/\x01/g, '.*');
  return new RegExp(`(^|/)${regexStr}($|/)`).test(normalized);
}

/**
 * SkillRegistry 负责加载和管理所有 Skills
 * 提供按触发类型（always/command/auto）查询的能力
 *
 * 内置 skill（systematic-debugging / brainstorming / verification-before-completion）
 * 总是先注入。磁盘加载出来的同名 skill 会覆盖内置版本——留给高级用户一个逃生口。
 */
export interface SkillRegistryOpts {
  /** 是否注入内置流程 skill，默认 true。测试里可以传 false 得到干净的 registry。 */
  builtins?: boolean;
}

export class SkillRegistry {
  private skills: Skill[] = [];
  private includeBuiltins: boolean;

  constructor(opts: SkillRegistryOpts = {}) {
    this.includeBuiltins = opts.builtins !== false;
    if (this.includeBuiltins) this.skills = getBuiltinSkills();
  }

  /** 从磁盘加载 skills（用户级 + 项目级）。同名会覆盖内置版本。 */
  loadFromDisk(opts: LoadSkillsOpts): void {
    const disk = loadSkills(opts);
    const byName = new Map<string, Skill>();
    if (this.includeBuiltins) {
      for (const s of getBuiltinSkills()) byName.set(s.name, s);
    }
    for (const s of disk) byName.set(s.name, s);
    this.skills = [...byName.values()];
  }

  /** 获取所有 always-on skills（总是注入 system prompt） */
  getAlwaysOn(): Skill[] {
    return this.skills.filter(s => s.trigger.type === 'always');
  }

  /** 按命令名查找 command-trigger skill */
  getByCommand(name: string): Skill | undefined {
    return this.skills.find(
      s => s.trigger.type === 'command' && s.trigger.name === name,
    );
  }

  /**
   * 匹配用户输入中的关键词，返回命中的 auto-trigger skills
   * 匹配规则：输入文本中包含 skill 定义的任一 keyword（不区分大小写）
   */
  matchByKeywords(input: string): Skill[] {
    const lower = input.toLowerCase();
    return this.skills.filter(s => {
      if (s.trigger.type !== 'auto') return false;
      return s.trigger.keywords.some(kw => lower.includes(kw.toLowerCase()));
    });
  }

  /**
   * 根据 session 中已读/已编辑的文件路径匹配 globs-trigger skills
   * 匹配规则：readFiles 中任一文件匹配 skill 定义的任一 glob pattern
   */
  matchByGlobs(readFiles: Set<string> | string[]): Skill[] {
    const files = Array.isArray(readFiles) ? readFiles : [...readFiles];
    if (files.length === 0) return [];
    return this.skills.filter(s => {
      if (s.trigger.type !== 'globs') return false;
      return s.trigger.patterns.some(pattern =>
        files.some(f => matchGlobSimple(pattern, f)),
      );
    });
  }

  /** 列出所有已加载的 skills */
  list(): Skill[] {
    return [...this.skills];
  }

  /** 手动注册一个 skill（用于测试或动态注入） */
  register(skill: Skill): void {
    // 同名覆盖
    const idx = this.skills.findIndex(s => s.name === skill.name);
    if (idx !== -1) {
      this.skills[idx] = skill;
    } else {
      this.skills.push(skill);
    }
  }
}
