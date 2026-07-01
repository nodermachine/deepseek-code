/**
 * @file 权限引擎
 * 实现三层优先级规则匹配（session > project > global）+危险命令黑名单
 * 支持通配符 '*' 匹配某工具的所有操作
 */
import type { PermissionRule, PermissionDecision } from './types.js';
import type { PermissionRequest } from '../tools/types.js';
import { isDangerous, sanitizeOutput } from './blacklist.js';

export { isDangerous, sanitizeOutput };

export type PermissionScope = 'session' | 'project' | 'global';

export interface PermissionEngineOpts {
  projectRules?: PermissionRule[];
  globalRules?: PermissionRule[];
}

/**
 * 权限引擎
 * 检查顺序：黑名单 → session 内存 → 项目规则 → 全局规则 → 默认 ask
 * matcher 支持 '*' 通配符，匹配该工具的任意操作
 */
export class PermissionEngine {
  private readonly project: PermissionRule[];
  private readonly global: PermissionRule[];
  private readonly session: PermissionRule[] = [];

  constructor(opts: PermissionEngineOpts = {}) {
    this.project = opts.projectRules ?? [];
    this.global = opts.globalRules ?? [];
  }

  check(req: PermissionRequest): PermissionDecision {
    // 1. 危险命令黑名单（最高优先级，不可覆盖）
    if (req.tool === 'Bash' && isDangerous(req.summary)) return 'forbidden';
    // 2. 三层规则查找（支持精确匹配和通配符 '*'）
    for (const layer of [this.session, this.project, this.global]) {
      const hit = layer.find(r => r.tool === req.tool && (r.matcher === req.matcher || r.matcher === '*'));
      if (hit) return hit.decision;
    }
    return 'ask';
  }

  remember(req: PermissionRequest, decision: 'allow' | 'deny', scope: PermissionScope): void {
    if (scope !== 'session') throw new Error('Only session-scope remember is supported in v0.1');
    this.session.push({ tool: req.tool, matcher: req.matcher, decision });
  }
}
