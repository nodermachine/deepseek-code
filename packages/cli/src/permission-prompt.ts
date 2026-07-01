/**
 * @file 权限交互提示
 * 当工具需要权限时，在终端显示询问并读取用户按键响应
 */
import { createInterface } from 'node:readline';
import pc from 'picocolors';
import type { PermissionRequest } from '@deepseek-code/core';

export type AskPermissionFn = (req: PermissionRequest) => Promise<{ decision: 'allow' | 'deny'; remember: boolean }>;

export function makeAskPermission(stdin: NodeJS.ReadableStream, stdout: NodeJS.WritableStream): AskPermissionFn {
  return async (req) => {
    stdout.write(pc.yellow(`[?] ${req.tool} wants: ${req.summary}\n`));
    stdout.write(`    [a] allow once  [A] allow for session  [d] deny once  [D] deny for session\n`);
    const rl = createInterface({ input: stdin as NodeJS.ReadableStream, output: stdout, terminal: false });
    const answer: string = await new Promise(res => rl.question('> ', a => { rl.close(); res(a); }));
    const c = answer.trim()[0] ?? 'd';
    switch (c) {
      case 'a': return { decision: 'allow', remember: false };
      case 'A': return { decision: 'allow', remember: true };
      case 'd': return { decision: 'deny', remember: false };
      case 'D': return { decision: 'deny', remember: true };
      default:  return { decision: 'deny', remember: false };
    }
  };
}
