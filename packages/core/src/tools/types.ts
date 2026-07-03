import type { ZodType } from 'zod';
import type { Logger } from '../logger.js';
import type { Provider } from '../provider/types.js';

export interface ToolSession {
  readFiles: Set<string>;
}

export interface ToolContext {
  cwd: string;
  signal: AbortSignal;
  logger: Logger;
  session: ToolSession;
  /** Sub-agent 支持：模型提供者（仅 Agent 工具使用） */
  provider?: Provider;
  /** Sub-agent 支持：工具注册表（仅 Agent 工具使用） */
  toolRegistry?: { get(name: string): Tool | undefined; toSchemas(): unknown[] };
  /** Sub-agent 支持：当前模型名（仅 Agent 工具使用） */
  model?: string;
}

export type ToolResult<O> =
  | { ok: true; output: O; display?: string }
  | { ok: false; error: string; recoverable: boolean };

export interface PermissionRequest {
  tool: string;
  matcher: string;
  summary: string;
}

export interface Tool<I = unknown, O = unknown> {
  name: string;
  description: string;
  inputSchema: ZodType<I>;
  needsPermission(input: I): PermissionRequest | null;
  execute(input: I, ctx: ToolContext): Promise<ToolResult<O>>;
}
