import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { Command } from './types.js';
import { parseCommandFile } from './parser.js';

export interface LoadCommandsOpts {
  cwd: string;
  homeDir?: string;
}

export function loadCommands(opts: LoadCommandsOpts): Command[] {
  const home = opts.homeDir ?? homedir();
  const out = new Map<string, Command>();

  const userDir = join(home, '.deepseek-code', 'commands');
  loadFromDir(userDir, userDir, 'user', out);

  const projectDir = join(opts.cwd, '.deepseek-code', 'commands');
  loadFromDir(projectDir, projectDir, 'project', out);

  return [...out.values()];
}

function loadFromDir(
  dir: string,
  baseDir: string,
  source: 'project' | 'user',
  out: Map<string, Command>,
): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.')) continue;
    const full = join(dir, entry);
    let stat;
    try { stat = statSync(full); } catch { continue; }
    if (stat.isDirectory()) {
      loadFromDir(full, baseDir, source, out);
      continue;
    }
    if (!entry.endsWith('.md')) continue;
    let raw;
    try { raw = readFileSync(full, 'utf8'); } catch { continue; }
    const cmd = parseCommandFile(raw, full, source, baseDir);
    if (cmd) out.set(cmd.name, cmd);
  }
}
