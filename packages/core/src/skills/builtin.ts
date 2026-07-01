/**
 * @file 内置流程 skills（代码内嵌，不走磁盘加载）
 *
 * 这三个 skill 覆盖调试、设计、验证三大流程环节。为什么必须代码内嵌？
 *
 * 情景反例：如果它们放到 .deepseek-code/skills/*.md 里靠 loader 加载，那
 * 一旦 loader 本身出 bug（比如 v0.3 早期那次 YAML frontmatter 全丢的问题），
 * 本该救火的这三个 skill 也一并挂掉，形成"bug 保护自己"的死循环。
 * 塞进代码里就与文件系统解耦，永远在场。
 *
 * 用户级 skill 同名可以覆盖内置版本（见 mergeBuiltinSkills）——留一个逃生口。
 */

import type { Skill } from './types.js';
import {
  SKILL_SYSTEMATIC_DEBUGGING,
  SKILL_BRAINSTORMING,
  SKILL_VERIFY_BEFORE_COMPLETION,
} from '../prompts.js';

export function getBuiltinSkills(): Skill[] {
  return [
    {
      name: 'systematic-debugging',
      description: '遇到 bug / 测试失败 / 意外行为时的调试流程：复现 → 3 个假设 → 排除 → 最小修改 → 复现验证',
      trigger: {
        type: 'auto',
        keywords: [
          'bug', 'debug', 'debugging', 'error', 'fails', 'failing', 'broken',
          '出错', '报错', '不对', '不生效', '坏了', '有 bug', '有bug', '失败', '不通过', '不行',
          'traceback', 'exception', 'stack trace', '为什么', 'why does', "doesn't work",
          '调试', '异常', '问题', '不工作', '不正常', 'issue', 'problem', 'unexpected',
          '挂了', '崩了', '有问题', '出问题', '怎么回事',
        ],
      },
      content: SKILL_SYSTEMATIC_DEBUGGING,
      filePath: '<builtin>',
    },
    {
      name: 'brainstorming',
      description: '实现新功能 / 重构 / 修改行为前的设计流程：确认范围 → 看现状 → 2-3 方案 → 拿到确认',
      trigger: {
        type: 'auto',
        keywords: [
          'implement', 'build', 'add a new', 'create a new', 'refactor', 'redesign',
          'design', 'plan', 'architect', 'how to', 'complex',
          '实现', '加一个', '新增', '重构', '重新设计', '开发', '写一个', '搞一个', '做个',
          '设计', '规划', '架构', '方案', '复杂', '帮我想', '怎么做', '改造',
        ],
      },
      content: SKILL_BRAINSTORMING,
      filePath: '<builtin>',
    },
    {
      name: 'verification-before-completion',
      description: '声称"完成/修好/通过"之前必须重跑原场景并贴真实输出的验证协议',
      trigger: { type: 'always' },
      content: SKILL_VERIFY_BEFORE_COMPLETION,
      filePath: '<builtin>',
    },
  ];
}
