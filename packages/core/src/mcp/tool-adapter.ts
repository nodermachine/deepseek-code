/**
 * @file MCP 工具适配器
 * 将 MCP Server 提供的工具定义转换为 deepseek-code 的 Tool 接口
 * 使 MCP 工具可以像内置工具一样被 Agent Loop 调用
 */
import { z } from 'zod';
import type { Tool, ToolContext, ToolResult } from '../tools/types.js';
import type { McpClient } from './client.js';
import type { McpToolDef } from './types.js';

/**
 * 将 MCP 工具定义适配为 deepseek-code Tool 接口
 * @param def MCP 工具定义（name + description + inputSchema）
 * @param client MCP 客户端实例（用于实际调用）
 * @param serverName MCP server 名称（用于权限标识）
 */
export function adaptMcpTool(def: McpToolDef, client: McpClient, serverName: string): Tool {
  return {
    name: `mcp_${serverName}_${def.name}`,
    description: `[MCP:${serverName}] ${def.description}`,
    // MCP 工具的 inputSchema 是 JSON Schema，用 z.any() 跳过本地校验（由 server 校验）
    inputSchema: z.any(),
    needsPermission(input: unknown) {
      // MCP 工具默认需要权限确认
      return {
        tool: `mcp_${serverName}_${def.name}`,
        matcher: serverName,
        summary: `MCP:${serverName}/${def.name}`,
      };
    },
    async execute(input: unknown, ctx: ToolContext): Promise<ToolResult<unknown>> {
      try {
        const result = await client.callTool(def.name, input);
        // 提取文本内容
        const text = result.content
          ?.filter(c => c.type === 'text' && c.text)
          .map(c => c.text)
          .join('\n') ?? '';

        if (result.isError) {
          return { ok: false, error: text || 'MCP tool execution failed', recoverable: true };
        }
        return { ok: true, output: text, display: text.slice(0, 200) };
      } catch (e: any) {
        return { ok: false, error: e.message ?? 'MCP call failed', recoverable: true };
      }
    },
  };
}

/**
 * 连接 MCP Server 并返回适配后的工具列表
 * @param client 已连接的 MCP 客户端
 * @param serverName server 配置名（如 "sqlite"、"browser"）
 */
export async function loadMcpTools(client: McpClient, serverName: string): Promise<Tool[]> {
  const defs = await client.listTools();
  return defs.map(def => adaptMcpTool(def, client, serverName));
}
