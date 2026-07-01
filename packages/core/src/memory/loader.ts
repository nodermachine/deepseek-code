/**
 * @file Memory 加载器
 * 加载用户级和项目级 DEEPSEEK.md 文件，拼接为 system prompt 内容
 * 加载优先级：用户级 (~/.deepseek-code/DEEPSEEK.md) + 项目级 (<cwd>/DEEPSEEK.md)
 * 阶段三新增：Skills always-on 注入
 */
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Skill } from '../skills/types.js';
import { getModelCapability } from '../provider/model-capabilities.js';

export interface LoadMemoryOpts {
  /** 当前工作目录 */
  cwd: string;
  /** 自定义 home 目录（测试用） */
  homeDir?: string;
}

/**
 * 加载 DEEPSEEK.md 记忆文件
 * 按优先级拼接用户级和项目级内容，返回合并后的 markdown 文本
 * 若两处均不存在则返回 null
 */
export function loadMemory(opts: LoadMemoryOpts): string | null {
  const home = opts.homeDir ?? homedir();
  const parts: string[] = [];

  // 用户级 DEEPSEEK.md
  const userPath = join(home, '.deepseek-code', 'DEEPSEEK.md');
  if (existsSync(userPath)) {
    parts.push(readFileSync(userPath, 'utf8').trim());
  }

  // 项目级：优先 <cwd>/DEEPSEEK.md，其次 <cwd>/.deepseek-code/DEEPSEEK.md
  const projectPath1 = join(opts.cwd, 'DEEPSEEK.md');
  const projectPath2 = join(opts.cwd, '.deepseek-code', 'DEEPSEEK.md');
  if (existsSync(projectPath1)) {
    parts.push(readFileSync(projectPath1, 'utf8').trim());
  } else if (existsSync(projectPath2)) {
    parts.push(readFileSync(projectPath2, 'utf8').trim());
  }

  return parts.length > 0 ? parts.join('\n\n---\n\n') : null;
}

export interface BuildSystemPromptOpts extends LoadMemoryOpts {
  /** always-on skills 内容（阶段三） */
  skills?: Skill[];
  /** 当前模型名（用于模型特定指令） */
  model?: string;
}

/**
 * 构建完整的 system prompt
 * 包含基础身份声明 + cwd + 模型特定指令 + DEEPSEEK.md 内容（如有）+ always-on skills
 */
export function buildSystemPrompt(opts: BuildSystemPromptOpts): string {
  const cap = opts.model ? getModelCapability(opts.model) : null;

  // 模型特定指令
  let modelHint = '';
  if (cap && !cap.toolCalls) {
    modelHint = `\n\n注意：当前模型不支持工具调用。请直接给出完整的代码和修改方案，用户会手动执行。`;
  } else if (cap && cap.thinking) {
    modelHint = `\n\n你拥有深度思考能力，请先分析再行动。对于复杂任务，先输出你的推理过程，再调用工具执行。`;
  }

  const base = `你是 deepseek-code，一个强大的命令行编码助手。你可以使用工具来读取、编辑、搜索文件以及执行 shell 命令。

当前工作目录：${opts.cwd}

规则：
- 使用 Read 工具前需要提供绝对路径
- 使用 Edit 工具前必须先 Read 该文件
- Bash 工具的命令在当前工作目录执行
- 如果不确定文件路径，先用 Grep 或 Bash(find/ls) 搜索
- 优先使用小步骤，避免一次性修改过多文件${modelHint}`;

  const parts = [base];

  // DEEPSEEK.md memory
  const memory = loadMemory(opts);
  if (memory) {
    parts.push(memory);
  }

  // always-on skills 注入（按名称字母排序，保证 prefix 稳定以利用 Prompt Cache）
  if (opts.skills && opts.skills.length > 0) {
    const sorted = [...opts.skills].sort((a, b) => a.name.localeCompare(b.name));
    const skillsContent = sorted
      .map(s => `[Skill: ${s.name}]\n${s.content}`)
      .join('\n\n');
    parts.push(skillsContent);
  }

  return parts.join('\n\n---\n\n');
}
