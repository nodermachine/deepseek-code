/**
 * @file 权限引擎
 * 实现三层优先级规则匹配（session > project > global）+危险命令黑名单
 * 支持通配符 '*' 匹配某工具的所有操作
 * 支持敏感路径门控：编辑关键文件时强制 ask
 */
import type { PermissionRule, PermissionDecision } from './types.js';
import type { PermissionRequest } from '../tools/types.js';
import { isDangerous, sanitizeOutput } from './blacklist.js';

export { isDangerous, sanitizeOutput };

export type PermissionScope = 'session' | 'project' | 'global';

export interface PermissionEngineOpts {
  projectRules?: PermissionRule[];
  globalRules?: PermissionRule[];
  /** 敏感路径 glob 列表，Edit/Write 这些路径时强制 ask（即使有全局 allow 规则） */
  sensitivePaths?: string[];
}

/**
 * 简单 glob 匹配：支持 ** 和 *
 * - '**' 匹配任意层级目录
 * - '*' 匹配单层目录内的任意字符
 */
function matchGlob(pattern: string, filePath: string): boolean {
  // 规范化路径分隔符
  const normalizedPath = filePath.replace(/\\/g, '/');
  // 将 glob pattern 转为 RegExp
  const regexStr = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '\x01')     // 临时占位
    .replace(/\*/g, '[^/]*')      // * 匹配单层
    .replace(/\x01/g, '.*');       // ** 匹配任意层
  return new RegExp(`(^|/)${regexStr}($|/)`).test(normalizedPath);
}

/**
 * 权限引擎
 * 检查顺序：黑名单 → 敏感路径 → session 内存 → 项目规则 → 全局规则 → 默认 ask
 * matcher 支持 '*' 通配符，匹配该工具的任意操作
 */
export class PermissionEngine {
  private readonly project: PermissionRule[];
  private readonly global: PermissionRule[];
  private readonly session: PermissionRule[] = [];
  private readonly sensitivePaths: string[];

  constructor(opts: PermissionEngineOpts = {}) {
    this.project = opts.projectRules ?? [];
    this.global = opts.globalRules ?? [];
    this.sensitivePaths = opts.sensitivePaths ?? [];
  }

  check(req: PermissionRequest): PermissionDecision {
    // 1. 危险命令黑名单（最高优先级，不可覆盖）
    if (req.tool === 'Bash' && isDangerous(req.summary)) return 'forbidden';
    // 2. 敏感路径门控：Edit/Write 命中敏感路径时强制 ask
    if ((req.tool === 'Edit' || req.tool === 'Write') && this.isSensitivePath(req.matcher)) {
      return 'ask';
    }
    // 3. 三层规则查找（支持精确匹配和通配符 '*'）
    for (const layer of [this.session, this.project, this.global]) {
      const hit = layer.find(r => r.tool === req.tool && (r.matcher === req.matcher || r.matcher === '*'));
      if (hit) return hit.decision;
    }
    return 'ask';
  }

  /** 检测文件路径是否匹配敏感路径规则 */
  private isSensitivePath(filePath: string): boolean {
    if (this.sensitivePaths.length === 0) return false;
    return this.sensitivePaths.some(pattern => matchGlob(pattern, filePath));
  }

  remember(req: PermissionRequest, decision: 'allow' | 'deny', scope: PermissionScope): void {
    if (scope !== 'session') throw new Error('Only session-scope remember is supported in v0.1');
    this.session.push({ tool: req.tool, matcher: req.matcher, decision });
  }
}
