import { existsSync, readdirSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, relative } from 'node:path';
import { score } from '../fuzzy/score.js';

const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', '.next', 'coverage', '.cache', '.git',
]);

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

  load(): void {
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
