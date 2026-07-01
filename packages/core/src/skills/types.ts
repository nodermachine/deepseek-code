/**
 * @file Skills 类型定义
 * Skill 是可注入 system prompt 的 Markdown 技能文件
 * 支持三种触发方式：always（总是注入）、command（斜杠命令触发）、auto（关键词匹配）
 */

/** Skill 触发方式 */
export type SkillTrigger =
  | { type: 'always' }                        // 总是注入到 system prompt
  | { type: 'command'; name: string }          // 通过 /skill-name 斜杠命令触发
  | { type: 'auto'; keywords: string[] };      // 用户输入包含关键词时自动触发

/** 单个技能定义 */
export interface Skill {
  /** 技能名称（文件名去掉 .md） */
  name: string;
  /** 技能描述（Markdown 第一个 # 标题） */
  description: string;
  /** 触发方式 */
  trigger: SkillTrigger;
  /** Markdown 正文内容（去除元数据注释后） */
  content: string;
  /** 来源文件绝对路径 */
  filePath: string;
}
