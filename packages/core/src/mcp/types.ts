/**
 * @file MCP (Model Context Protocol) 类型定义
 * 定义 MCP 协议的核心接口：传输层、工具定义、调用结果
 */

/** MCP 传输方式 */
export type McpTransport =
  | { type: 'stdio'; command: string; args?: string[]; env?: Record<string, string> }
  | { type: 'sse'; url: string; headers?: Record<string, string> };

/** MCP Server 配置（在 config.json 中） */
export interface McpServerConfig {
  /** 传输类型 */
  type: 'stdio' | 'sse';
  /** stdio 模式的命令 */
  command?: string;
  /** stdio 模式的参数 */
  args?: string[];
  /** stdio 模式的环境变量 */
  env?: Record<string, string>;
  /** SSE 模式的 URL */
  url?: string;
  /** SSE 模式的请求头 */
  headers?: Record<string, string>;
}

/** MCP 工具定义（从 server 获取） */
export interface McpToolDef {
  /** 工具名称 */
  name: string;
  /** 工具描述 */
  description: string;
  /** JSON Schema 格式的输入参数定义 */
  inputSchema: Record<string, unknown>;
}

/** MCP 工具调用结果 */
export interface McpToolResult {
  content: Array<{ type: string; text?: string; data?: string }>;
  isError?: boolean;
}

/** MCP JSON-RPC 请求 */
export interface McpRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

/** MCP JSON-RPC 响应 */
export interface McpResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}
