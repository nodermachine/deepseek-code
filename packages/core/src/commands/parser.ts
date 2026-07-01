import { basename, relative, dirname } from 'node:path';
import type { Command } from './types.js';

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;

function parseFrontmatter(raw: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const line of raw.split('\n')) {
    const m = line.match(/^([\w-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const [, key, val] = m;
    const trimmed = val.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      out[key] = trimmed.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean);
    } else {
      out[key] = trimmed;
    }
  }
  return out;
}

export function parseCommandFile(
  raw: string,
  filePath: string,
  source: 'project' | 'user',
  baseDir?: string,
): Command | null {
  let body = raw;
  let fm: Record<string, string | string[]> = {};
  const m = raw.match(FRONTMATTER_RE);
  if (m) {
    fm = parseFrontmatter(m[1]);
    body = raw.slice(m[0].length);
  }
  body = body.trim();
  if (!body) return null;

  const fileBase = basename(filePath, '.md');
  let name = fileBase;
  if (baseDir) {
    const relDir = relative(baseDir, dirname(filePath));
    if (relDir && relDir !== '.') {
      name = `${relDir.split(/[/\\]/).join(':')}:${fileBase}`;
    }
  }

  const description = typeof fm.description === 'string'
    ? fm.description
    : body.split('\n').find((l) => l.trim().length > 0)?.trim() ?? name;

  return {
    name,
    description,
    argumentHint: typeof fm['argument-hint'] === 'string' ? fm['argument-hint'] : undefined,
    allowedTools: Array.isArray(fm['allowed-tools']) ? (fm['allowed-tools'] as string[]) : undefined,
    model: typeof fm.model === 'string' ? fm.model : undefined,
    body,
    source,
    filePath,
  };
}

export function expandArguments(body: string, args: string): string {
  const parts = args.split(/\s+/).filter(Boolean);
  let out = body.replace(/\$ARGUMENTS\b/g, args);
  out = out.replace(/\$(\d+)\b/g, (m, n) => {
    const idx = parseInt(n, 10) - 1;
    return parts[idx] ?? m;
  });
  return out;
}
