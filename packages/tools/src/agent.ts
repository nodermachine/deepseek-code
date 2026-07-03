/**
 * @file Agent 工具（Sub-agent）
 * 允许主 agent 派生子 agent 执行独立的搜索/分析任务。
 * 子 agent 有独立消息流、受限工具集、可选模型，完成后返回文本结果。
 *
 * 参考 Claude Code AgentTool，MVP 范围：同步执行、只读默认。
 */
import { z } from 'zod';
import type { Tool, ToolContext, ToolResult } from '@deepseek-code/core';

const InputSchema = z.object({
  /** 子 agent 执行的任务描述（应清晰具体） */
  prompt: z.string().describe('子 agent 执行的任务描述，应清晰具体，包含搜索目标和期望输出格式'),
  /** 模型选择，默认继承父 agent 的模型 */
  model: z.string().optional().describe('可选的模型覆盖，如 deepseek-v4-flash 用于轻量搜索'),
  /** 允许的工具列表，默认 [Read, Grep, Glob, Bash] */
  allowedTools: z.array(z.string()).optional().describe('允许的工具列表，默认 [Read, Grep, Glob, Bash]'),
});

type AgentInput = z.infer<typeof InputSchema>;

/** Agent 工具输出 */
interface AgentOutput {
  result: string;
  tokens: { prompt: number; completion: number };
}

/**
 * Agent 工具定义
 * 主 agent 可通过此工具派生子 agent 执行独立任务（搜索、分析、调研）
 */
export const agentTool: Tool<AgentInput, AgentOutput> = {
  name: 'Agent',
  description: '派生子 agent 执行独立搜索/分析任务。子 agent 有独立上下文，默认只读（Read/Grep/Glob/Bash），完成后返回结果。适用于：并行搜索、代码分析、信息收集等不需要修改文件的任务。',
  inputSchema: InputSchema,

  needsPermission(input) {
    return {
      tool: 'Agent',
      matcher: input.prompt.slice(0, 50),
      summary: `子 agent: ${input.prompt.slice(0, 80)}`,
    };
  },

  async execute(input, ctx): Promise<ToolResult<AgentOutput>> {
    // Agent 工具需要 provider 和 registry 通过 ToolContext 传入
    if (!ctx.provider || !ctx.toolRegistry) {
      return {
        ok: false,
        error: 'Agent 工具需要 provider 和 toolRegistry 支持（通过 ToolContext 注入）',
        recoverable: false,
      };
    }

    // 动态导入 runSubAgent（避免 tools 包直接依赖 core 的 agent 模块）
    const { runSubAgent } = await import('@deepseek-code/core');

    try {
      const result = await runSubAgent({
        provider: ctx.provider,
        parentSession: { readFiles: ctx.session.readFiles } as any,
        prompt: input.prompt,
        model: input.model,
        defaultModel: ctx.model ?? 'deepseek-v4-flash',
        allowedTools: input.allowedTools,
        signal: ctx.signal,
        logger: ctx.logger,
        registry: ctx.toolRegistry as any,
      });

      if (result.ok) {
        return {
          ok: true,
          output: {
            result: result.output,
            tokens: { prompt: result.tokenUsage.prompt_tokens, completion: result.tokenUsage.completion_tokens },
          },
        };
      } else {
        return {
          ok: false,
          error: result.output,
          recoverable: true,
        };
      }
    } catch (e: any) {
      return {
        ok: false,
        error: `子 agent 异常: ${e.message}`,
        recoverable: true,
      };
    }
  },
};
