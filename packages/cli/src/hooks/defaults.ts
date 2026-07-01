/**
 * @file 默认内置 Hooks
 * 提供开箱即用的钩子：模型调用日志、危险命令确认、错误上报、轮次统计
 */
import { createInterface } from 'node:readline';
import type { Hook, HookContext } from '@deepseek-code/core';
import type { Logger } from '@deepseek-code/core';

/**
 * 创建默认 hooks 集合
 * @param opts.logger 日志器（用于记录 hook 触发事件）
 * @param opts.stdout 输出流（用于打印信息到终端）
 */
export function createDefaultHooks(opts: {
  logger: Logger;
  stdout: NodeJS.WritableStream;
  stdin?: NodeJS.ReadableStream;
}): Hook[] {
  const { logger, stdout, stdin } = opts;

  return [
    // Hook 1: 模型调用追踪 — 记录每次模型调用的消息数量
    {
      name: 'builtin:provider-trace',
      point: 'afterProviderCall',
      priority: 90,
      handler: (ctx: HookContext) => {
        if (ctx.data.type === 'afterProviderCall') {
          const { content, toolCallCount } = ctx.data;
          logger.info('provider call completed', {
            contentLength: content.length,
            toolCallCount,
            messageCount: ctx.session.messages.length,
          });
        }
      },
    },

    // Hook 2: 危险命令确认 — 对高危 bash 命令询问用户是否继续
    {
      name: 'builtin:danger-guard',
      point: 'beforeToolExecute',
      priority: 10,
      handler: async (ctx: HookContext) => {
        if (ctx.data.type === 'beforeToolExecute' && ctx.data.toolName === 'Bash') {
          const input = ctx.data.input as { command?: string };
          const cmd = input.command ?? '';
          // 检测高危模式
          const dangerPatterns = [
            /rm\s+(-rf?|--recursive)\s+\//,  // rm -rf /
            /mkfs\./,                          // 格式化磁盘
            /dd\s+if=.*of=\/dev/,             // dd 写入设备
            />\s*\/dev\/sd/,                   // 重定向到块设备
            /chmod\s+(-R\s+)?777\s+\//,       // chmod 777 /
          ];
          const isDangerous = dangerPatterns.some(p => p.test(cmd));
          if (isDangerous) {
            logger.warn('dangerous command detected', { command: cmd, toolId: ctx.data.toolId });
            // 交互式询问用户
            const confirmed = await askUserConfirm(
              stdout,
              stdin ?? process.stdin,
              `\x1b[33m⚠ 检测到危险命令:\x1b[0m ${cmd}\n  是否继续执行？[y/N] `,
            );
            if (!confirmed) {
              ctx.abort(); // 用户拒绝才中止
            }
          }
        }
      },
    },

    // Hook 3: 错误追踪 — 记录所有 provider/工具错误到日志
    {
      name: 'builtin:error-tracker',
      point: 'onError',
      priority: 50,
      handler: (ctx: HookContext) => {
        if (ctx.data.type === 'onError') {
          logger.error('agent loop error', {
            code: ctx.data.error.code,
            message: ctx.data.error.userMessage,
          });
        }
      },
    },

    // Hook 4: 轮次统计 — loop 结束时输出 token 消耗
    {
      name: 'builtin:turn-stats',
      point: 'onDone',
      priority: 100,
      handler: (ctx: HookContext) => {
        if (ctx.data.type === 'onDone') {
          const { usage } = ctx.session;
          if (usage.total_tokens > 0) {
            const statsLine = `\x1b[2m[tokens: ${usage.prompt_tokens}↑ ${usage.completion_tokens}↓ = ${usage.total_tokens}]\x1b[0m\n`;
            stdout.write(statsLine);
          }
        }
      },
    },
  ];
}

/**
 * 交互式确认：向用户提问并等待 y/N 回复
 * @param stdout 输出流
 * @param stdin 输入流
 * @param prompt 提示信息
 * @returns 用户确认返回 true，否则 false
 */
function askUserConfirm(stdout: NodeJS.WritableStream, stdin: NodeJS.ReadableStream, prompt: string): Promise<boolean> {
  return new Promise((resolve) => {
    stdout.write(prompt);
    const rl = createInterface({ input: stdin, terminal: false });
    rl.once('line', (answer: string) => {
      rl.close();
      const a = answer.trim().toLowerCase();
      resolve(a === 'y' || a === 'yes');
    });
    // 如果 stdin 关闭则默认拒绝
    rl.once('close', () => resolve(false));
  });
}
