/**
 * @file Bash 工具
 * 执行 shell 命令，捕获 stdout/stderr/exit_code
 * 支持超时强制终止、AbortSignal 取消、输出截断
 */
import { spawn } from 'node:child_process';
import { z } from 'zod';
import type { Tool } from '@deepseek-code/core';

const InputSchema = z.object({
  command: z.string().min(1),
  timeout_ms: z.number().int().positive().max(600_000).optional(),
});

export interface BashOutput {
  stdout: string;
  stderr: string;
  exit_code: number;
  timed_out: boolean;
}

/** 已知子命令型工具（取前两个 token 作为权限 matcher） */
const KNOWN_SUBCOMMAND_TOOLS = new Set(['git','npm','pnpm','yarn','pip','pip3','cargo','go','kubectl','docker','python','python3','node','rustc']);
const DEFAULT_TIMEOUT = 30_000;
const MAX_OUTPUT = 256 * 1024;

/**
 * 提取命令的“特征前缀”用于权限记忆
 * - 子命令型工具（git/npm等）：取前两个 token，如 'git status'
 * - 其他：取第一个 token，如 'ls'
 */
export function commandPrefix(cmd: string): string {
  const tokens = cmd.trim().split(/\s+/);
  if (tokens.length >= 2 && KNOWN_SUBCOMMAND_TOOLS.has(tokens[0])) {
    return `${tokens[0]} ${tokens[1]}`;
  }
  return tokens[0] ?? '';
}

/** 截断过长输出（防止回喂模型时超限） */
function truncate(s: string): string {
  if (s.length <= MAX_OUTPUT) return s;
  return s.slice(0, MAX_OUTPUT) + '\n...[truncated]\n';
}

export const bashTool: Tool<z.infer<typeof InputSchema>, BashOutput> = {
  name: 'Bash',
  description: '执行 shell 命令并返回 stdout/stderr/exit_code。命令会按超时强制终止。',
  inputSchema: InputSchema,
  needsPermission(input) {
    return { tool: 'Bash', matcher: commandPrefix(input.command), summary: input.command };
  },
  async execute(input, ctx) {
    const timeout = input.timeout_ms ?? DEFAULT_TIMEOUT;
    return new Promise((resolve) => {
      // env 白名单：不继承完整 process.env，避免 API Key 等敏感信息泄露给子命令
      const safeEnv: Record<string, string> = {};
      const ALLOWED_ENV = ['PATH', 'HOME', 'USER', 'SHELL', 'LANG', 'LC_ALL', 'TERM', 'EDITOR', 'NODE_PATH', 'NVM_DIR', 'GOPATH', 'CARGO_HOME'];
      for (const key of ALLOWED_ENV) {
        if (process.env[key]) safeEnv[key] = process.env[key]!;
      }
      const child = spawn('bash', ['-c', input.command], { cwd: ctx.cwd, env: safeEnv });
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      child.stdout.on('data', (d: Buffer) => { stdout += d.toString('utf8'); });
      child.stderr.on('data', (d: Buffer) => { stderr += d.toString('utf8'); });
      const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeout);
      const onAbort = () => { child.kill('SIGKILL'); };
      ctx.signal.addEventListener('abort', onAbort, { once: true });
      child.on('close', (code) => {
        clearTimeout(timer);
        ctx.signal.removeEventListener('abort', onAbort);
        resolve({
          ok: true,
          output: {
            stdout: truncate(stdout),
            stderr: truncate(stderr),
            exit_code: code ?? -1,
            timed_out: timedOut,
          },
          display: stdout + (stderr ? `\n[stderr]\n${stderr}` : ''),
        });
      });
    });
  },
};
