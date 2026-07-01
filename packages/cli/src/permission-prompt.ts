/**
 * @file 权限交互提示
 * 当工具需要权限时，在终端显示询问并读取用户按键响应
 * 支持 headless 模式下的自动决策
 */
import { createInterface } from 'node:readline';
import pc from 'picocolors';
import type { PermissionRequest } from '@deepseek-code/core';

export type AskPermissionFn = (req: PermissionRequest) => Promise<{ decision: 'allow' | 'deny'; remember: boolean }>;

/** 信任级别（headless 模式用） */
export type TrustLevel = 'none' | 'tools' | 'full';

/** 交互式权限确认（正常 REPL 模式） */
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

/**
 * Headless 模式权限自动决策（无交互）
 * - none: 全部拒绝
 * - tools: Read/Edit/Write/Grep/Glob/WebFetch allow，Bash deny
 * - full: 全部允许
 */
export function makeHeadlessPermission(trust: TrustLevel): AskPermissionFn {
  return async (req) => {
    switch (trust) {
      case 'full':
        return { decision: 'allow', remember: true };
      case 'tools':
        // Bash 工具拒绝，其他允许
        if (req.tool === 'Bash') return { decision: 'deny', remember: false };
        return { decision: 'allow', remember: true };
      case 'none':
      default:
        return { decision: 'deny', remember: false };
    }
  };
}
