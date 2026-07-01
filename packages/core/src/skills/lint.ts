/**
 * @file Skill 载入告警
 * 检测 skill 定义里容易出问题的模式，给用户一个"skill 医生"。
 */
import type { Skill } from './types.js';

export interface SkillWarning {
  skillName: string;
  code:
    | 'missing-description'
    | 'auto-without-keywords'
    | 'always-too-large'
    | 'command-collides-with-builtin'
    | 'html-comment-metadata-only';
  message: string;
}

/** always-on skill 的 content 若超过这个字符数就警告——每 turn 都进 prompt，会显著吃 token 预算。 */
const ALWAYS_ON_SOFT_LIMIT = 4000;

const BUILTIN_COMMAND_NAMES = new Set([
  'help', 'model', 'config', 'plan', 'skills', 'clear',
  'sessions', 'compact', 'memory', 'init', 'resume', 'quit', 'exit', 'cancel',
]);

export function lintSkills(skills: Skill[]): SkillWarning[] {
  const warnings: SkillWarning[] = [];
  for (const s of skills) {
    if (!s.description || s.description === s.name) {
      warnings.push({
        skillName: s.name,
        code: 'missing-description',
        message: '缺少 description（或退化成 skill 名）——补 YAML frontmatter 的 description 字段',
      });
    }
    if (s.trigger.type === 'auto' && (s.trigger.keywords.length === 0 || (s.trigger.keywords.length === 1 && s.trigger.keywords[0] === s.name))) {
      warnings.push({
        skillName: s.name,
        code: 'auto-without-keywords',
        message: 'trigger: auto 但没有关键词——不会被自动匹配。补 keywords 字段。',
      });
    }
    if (s.trigger.type === 'always' && s.content.length > ALWAYS_ON_SOFT_LIMIT) {
      warnings.push({
        skillName: s.name,
        code: 'always-too-large',
        message: `always-on 但 body ${s.content.length} 字符 > ${ALWAYS_ON_SOFT_LIMIT}——每 turn 都会进 system prompt，吃 token 预算。考虑改成 auto 或精简。`,
      });
    }
    if (s.trigger.type === 'command' && BUILTIN_COMMAND_NAMES.has(s.trigger.name)) {
      warnings.push({
        skillName: s.name,
        code: 'command-collides-with-builtin',
        message: `command 触发名 "${s.trigger.name}" 与内置 slash 命令冲突——skill 命令永远不会被触发。改名或用 /skills/${s.name}。`,
      });
    }
    // 仅有 HTML 注释元数据（老格式）：不是错误，但提醒可以升级
    const hasFrontmatter = s.filePath !== '<builtin>' && s.content.startsWith('---');
    const hasHtmlComment = /<!--\s*(trigger|keywords)\s*:/i.test(s.content);
    if (!hasFrontmatter && hasHtmlComment) {
      warnings.push({
        skillName: s.name,
        code: 'html-comment-metadata-only',
        message: '用 HTML 注释元数据。推荐迁移到 YAML frontmatter（对齐 skills.sh 生态）。',
      });
    }
  }
  return warnings;
}
