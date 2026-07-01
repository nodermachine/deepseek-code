import type { ZodType } from 'zod';
import type { Logger } from '../logger.js';

export interface ToolSession {
  readFiles: Set<string>;
}

export interface ToolContext {
  cwd: string;
  signal: AbortSignal;
  logger: Logger;
  session: ToolSession;
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
