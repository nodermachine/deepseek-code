import type { Command } from './types.js';
import { loadCommands, type LoadCommandsOpts } from './loader.js';
import { score } from '../fuzzy/score.js';

const PRIORITY: Record<Command['source'], number> = {
  builtin: 0,
  project: 1,
  user: 2,
  skill: 3,
};

export interface FilteredCommand {
  cmd: Command;
  matches: number[];
  score: number;
}

export class CommandRegistry {
  private byName = new Map<string, Command>();

  registerBuiltin(cmd: Omit<Command, 'source'> & { source?: Command['source'] }): void {
    this.byName.set(cmd.name, { ...cmd, source: 'builtin' });
  }

  loadFromDisk(opts: LoadCommandsOpts): void {
    for (const c of loadCommands(opts)) {
      const existing = this.byName.get(c.name);
      if (!existing || PRIORITY[c.source] < PRIORITY[existing.source]) {
        this.byName.set(c.name, c);
      }
    }
  }

  ingestSkillCommands(
    skills: Array<{
      name: string;
      description: string;
      content: string;
      trigger: { type: string; name?: string };
    }>,
  ): void {
    for (const s of skills) {
      if (s.trigger.type !== 'command') continue;
      const cmdName = s.trigger.name ?? s.name;
      if (this.byName.has(cmdName)) continue;
      this.byName.set(cmdName, {
        name: cmdName,
        description: s.description,
        body: s.content,
        source: 'skill',
      });
    }
  }

  resolve(name: string): Command | undefined {
    return this.byName.get(name);
  }

  list(): Command[] {
    return [...this.byName.values()].sort((a, b) => {
      const p = PRIORITY[a.source] - PRIORITY[b.source];
      return p !== 0 ? p : a.name.localeCompare(b.name);
    });
  }

  filter(query: string): FilteredCommand[] {
    if (!query) return this.list().map((cmd) => ({ cmd, matches: [], score: 0 }));
    const results: FilteredCommand[] = [];
    for (const cmd of this.byName.values()) {
      const r = score(query, cmd.name);
      if (!r) continue;
      results.push({ cmd, matches: r.matches, score: r.score });
    }
    return results.sort(
      (a, b) => b.score - a.score || a.cmd.name.localeCompare(b.cmd.name),
    );
  }
}
