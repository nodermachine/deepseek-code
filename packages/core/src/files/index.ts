import { existsSync, readdirSync, statSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, relative, dirname } from 'node:path';
import { score } from '../fuzzy/score.js';

const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', '.next', 'coverage', '.cache', '.git',
]);

/** 索引缓存文件路径 */
const CACHE_FILE = '.deepseek-code/file-index.json';

interface CacheData {
  /** 缓存时的 git HEAD commit hash */
  headCommit: string;
  paths: string[];
}

export interface FileIndexOpts {
  cwd: string;
}

export interface FileHit {
  path: string;
  matches: number[];
  score: number;
}

export class FileIndex {
  private paths: string[] = [];
  constructor(private opts: FileIndexOpts) {}

  /**
   * 加载文件索引
   * 策略：缓存存在且 HEAD 未变 → 直接读缓存；否则重新扫描并写入缓存
   */
  load(): void {
    const cachePath = join(this.opts.cwd, CACHE_FILE);
    const currentHead = this.getHeadCommit();

    // 尝试读取缓存
    if (currentHead && existsSync(cachePath)) {
      try {
        const cache: CacheData = JSON.parse(readFileSync(cachePath, 'utf8'));
        if (cache.headCommit === currentHead && cache.paths.length > 0) {
          this.paths = cache.paths;
          return;
        }
      } catch { /* 缓存损坏，重新扫描 */ }
    }

    // 全量扫描
    this.fullScan();

    // 写入缓存
    if (currentHead) {
      try {
        mkdirSync(dirname(cachePath), { recursive: true });
        writeFileSync(cachePath, JSON.stringify({ headCommit: currentHead, paths: this.paths }));
      } catch { /* 缓存写入失败不影响主流程 */ }
    }
  }

  private fullScan(): void {
    if (existsSync(join(this.opts.cwd, '.git'))) {
      try {
        const out = execSync('git ls-files --cached --others --exclude-standard', {
          cwd: this.opts.cwd,
          encoding: 'utf8',
          maxBuffer: 64 * 1024 * 1024,
        });
        this.paths = out.split('\n').filter(Boolean);
        return;
      } catch {
        // fall through to fs scan
      }
    }
    this.paths = [];
    this.walk(this.opts.cwd);
  }

  /** 获取当前 git HEAD commit hash */
  private getHeadCommit(): string | null {
    try {
      return execSync('git rev-parse HEAD', { cwd: this.opts.cwd, encoding: 'utf8' }).trim();
    } catch {
      return null;
    }
  }

  private walk(dir: string): void {
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }
    for (const e of entries) {
      if (SKIP_DIRS.has(e)) continue;
      if (e.startsWith('.') && e !== '.deepseek-code') continue;
      const full = join(dir, e);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) {
        this.walk(full);
      } else if (st.isFile()) {
        this.paths.push(relative(this.opts.cwd, full));
      }
    }
  }

  all(): string[] {
    return this.paths;
  }

  search(query: string, limit = 30): FileHit[] {
    if (!query) {
      return this.paths.slice(0, limit).map((p) => ({ path: p, matches: [], score: 0 }));
    }
    const results: FileHit[] = [];
    for (const p of this.paths) {
      const r = score(query, p);
      if (!r) continue;
      results.push({ path: p, matches: r.matches, score: r.score });
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }
}
