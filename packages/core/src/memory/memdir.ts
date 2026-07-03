/**
 * @file Memory 目录加载器
 * 支持从 memory/ 目录加载多个 .md 文件作为结构化内存。
 * 与 DEEPSEEK.md 单文件方式互补——DEEPSEEK.md 用于项目简介和规范，
 * memory/ 目录用于累积式的知识条目（用户偏好、参考资料等）。
 *
 * 文件名约定：
 * - user-*.md — 用户级偏好/习惯
 * - project-*.md — 项目级规范/约定
 * - ref-*.md — 参考资料/文档片段
 * - 无前缀 — 通用记忆条目
 *
 * 截断保护：总内容超过 MAX_MEMORY_BYTES 时，跳过最老的文件。
 */
import { existsSync, readdirSync, readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';

/** 内存总量上限（25KB），超过后跳过最老的文件 */
const MAX_MEMORY_BYTES = 25 * 1024;

/** 内存条目类型 */
export type MemoryType = 'user' | 'project' | 'ref' | 'general';

/** 单个内存条目 */
export interface MemoryEntry {
  /** 文件名（不含路径） */
  fileName: string;
  /** 内存类型（由文件名前缀推断） */
  type: MemoryType;
  /** 内容 */
  content: string;
  /** 文件修改时间 */
  mtime: Date;
  /** 来源路径 */
  filePath: string;
}

/**
 * 从文件名推断内存类型
 */
function inferType(fileName: string): MemoryType {
  if (fileName.startsWith('user-') || fileName.startsWith('user_')) return 'user';
  if (fileName.startsWith('project-') || fileName.startsWith('project_')) return 'project';
  if (fileName.startsWith('ref-') || fileName.startsWith('ref_')) return 'ref';
  return 'general';
}

/**
 * 加载单个 memory 目录下的所有 .md 文件
 * @returns 按修改时间升序排列的条目（最老的在前）
 */
function loadDir(dir: string): MemoryEntry[] {
  if (!existsSync(dir)) return [];
  const entries: MemoryEntry[] = [];
  let files: string[];
  try { files = readdirSync(dir); } catch { return []; }

  for (const f of files) {
    if (!f.endsWith('.md') || f.startsWith('.')) continue;
    const full = join(dir, f);
    let stat;
    try { stat = statSync(full); } catch { continue; }
    if (!stat.isFile()) continue;
    const content = readFileSync(full, 'utf8').trim();
    if (!content) continue;
    entries.push({
      fileName: f,
      type: inferType(f),
      content,
      mtime: stat.mtime,
      filePath: full,
    });
  }
  // 按修改时间升序（最老的在前，截断时优先跳过）
  return entries.sort((a, b) => a.mtime.getTime() - b.mtime.getTime());
}

export interface LoadMemoryDirOpts {
  cwd: string;
  homeDir?: string;
}

/**
 * 加载所有 memory 目录内容（用户级 + 项目级）
 * 带截断保护：总字节数超过 MAX_MEMORY_BYTES 时跳过最老的条目
 * @returns 拼接后的文本（可直接注入 system prompt）
 */
export function loadMemoryDir(opts: LoadMemoryDirOpts): string | null {
  const home = opts.homeDir ?? homedir();
  const userDir = join(home, '.deepseek-code', 'memory');
  const projectDir = join(opts.cwd, '.deepseek-code', 'memory');

  // 合并两个目录的条目（用户级 + 项目级）
  const allEntries = [...loadDir(userDir), ...loadDir(projectDir)];
  if (allEntries.length === 0) return null;

  // 按修改时间降序（最新的优先保留）
  allEntries.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

  // 截断保护：从最新开始累积，超过上限时停止
  const kept: MemoryEntry[] = [];
  let totalBytes = 0;
  for (const entry of allEntries) {
    const bytes = Buffer.byteLength(entry.content, 'utf8');
    if (totalBytes + bytes > MAX_MEMORY_BYTES) break;
    kept.push(entry);
    totalBytes += bytes;
  }

  if (kept.length === 0) return null;

  // 按类型分组输出
  const groups: Record<MemoryType, string[]> = { user: [], project: [], ref: [], general: [] };
  for (const e of kept) {
    groups[e.type].push(e.content);
  }

  const parts: string[] = [];
  if (groups.user.length > 0) parts.push(`[User Preferences]\n${groups.user.join('\n\n')}`);
  if (groups.project.length > 0) parts.push(`[Project Memory]\n${groups.project.join('\n\n')}`);
  if (groups.ref.length > 0) parts.push(`[References]\n${groups.ref.join('\n\n')}`);
  if (groups.general.length > 0) parts.push(`[Memory]\n${groups.general.join('\n\n')}`);

  return parts.join('\n\n---\n\n');
}

export interface AddMemoryOpts {
  /** 内存类型 */
  type: MemoryType;
  /** 内容 */
  content: string;
  /** 作用域：user 存到 ~/.deepseek-code/memory/，project 存到 .deepseek-code/memory/ */
  scope: 'user' | 'project';
  /** 当前工作目录 */
  cwd: string;
  homeDir?: string;
}

/**
 * 添加一条内存条目到 memory 目录
 * 文件名格式：<type>-<timestamp>.md
 */
export function addMemoryEntry(opts: AddMemoryOpts): string {
  const home = opts.homeDir ?? homedir();
  const dir = opts.scope === 'user'
    ? join(home, '.deepseek-code', 'memory')
    : join(opts.cwd, '.deepseek-code', 'memory');

  mkdirSync(dir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const prefix = opts.type === 'general' ? '' : `${opts.type}-`;
  const fileName = `${prefix}${timestamp}.md`;
  const filePath = join(dir, fileName);

  writeFileSync(filePath, opts.content.trim() + '\n');
  return filePath;
}
