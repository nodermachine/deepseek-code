import { existsSync, mkdirSync, appendFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

export interface AppendMemoryOpts {
  scope: 'project' | 'user';
  text: string;
  cwd: string;
  homeDir?: string;
}

export interface AppendMemoryResult {
  filePath: string;
  created: boolean;
}

export function appendMemory(opts: AppendMemoryOpts): AppendMemoryResult {
  const home = opts.homeDir ?? homedir();
  const filePath =
    opts.scope === 'user'
      ? join(home, '.deepseek-code', 'DEEPSEEK.md')
      : join(opts.cwd, 'DEEPSEEK.md');

  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const line = `- ${opts.text.trim()}\n`;
  if (!existsSync(filePath)) {
    writeFileSync(filePath, `# Memory\n\n${line}`);
    return { filePath, created: true };
  }
  appendFileSync(filePath, line);
  return { filePath, created: false };
}
