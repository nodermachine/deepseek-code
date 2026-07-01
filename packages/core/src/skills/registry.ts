/**
 * @file Skills 注册表
 * 管理已加载的 Skills，提供按触发类型查询的 API
 */
import type { Skill } from './types.js';
import { loadSkills, type LoadSkillsOpts } from './loader.js';

/**
 * SkillRegistry 负责加载和管理所有 Skills
 * 提供按触发类型（always/command/auto）查询的能力
 */
export class SkillRegistry {
  private skills: Skill[] = [];

  /** 从磁盘加载 skills（用户级 + 项目级） */
  loadFromDisk(opts: LoadSkillsOpts): void {
    this.skills = loadSkills(opts);
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
