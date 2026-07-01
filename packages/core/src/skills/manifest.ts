/**
 * @file Skills 安装清单管理
 * 管理 .installed.json 的读写，记录已安装 skill 的来源和文件列表
 * 用于支持卸载和更新操作
 */
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { SkillSource } from './resolver.js';

/** 单个已安装 skill 的元数据 */
export interface InstalledEntry {
  /** 原始安装来源 */
  source: string;
  /** 解析后的来源类型 */
  sourceType: SkillSource['type'];
  /** 版本（如有） */
  version?: string;
  /** 安装时间 */
  installedAt: string;
  /** 安装到目标目录的文件列表（相对于 skills 目录） */
  files: string[];
}

/** 清单文件名 */
const MANIFEST_FILE = '.installed.json';

/** 读取安装清单 */
export function readManifest(dir: string): Record<string, InstalledEntry> {
  const path = join(dir, MANIFEST_FILE);
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
}

/** 写入安装清单 */
export function writeManifest(dir: string, manifest: Record<string, InstalledEntry>): void {
  const path = join(dir, MANIFEST_FILE);
  writeFileSync(path, JSON.stringify(manifest, null, 2));
}

/** 添加一条安装记录 */
export function addEntry(dir: string, name: string, entry: InstalledEntry): void {
  const manifest = readManifest(dir);
  manifest[name] = entry;
  writeManifest(dir, manifest);
}

/** 移除一条安装记录，并删除对应文件 */
export function removeEntry(dir: string, name: string): { removed: boolean; files: string[] } {
  const manifest = readManifest(dir);
  const entry = manifest[name];
  if (!entry) return { removed: false, files: [] };

  // 删除文件
  const removedFiles: string[] = [];
  for (const file of entry.files) {
    const filePath = join(dir, file);
    if (existsSync(filePath)) {
      unlinkSync(filePath);
      removedFiles.push(file);
    }
  }

  // 更新清单
  delete manifest[name];
  writeManifest(dir, manifest);
  return { removed: true, files: removedFiles };
}
