import { describe, it, expect } from 'vitest';
import { parseCommandFile, expandArguments } from '../../src/commands/parser.js';

describe('parseCommandFile', () => {
  it('parses full frontmatter', () => {
    const raw = `---
description: Create PR
argument-hint: <base>
allowed-tools: [Bash, Read]
model: deepseek-chat
---
body $1 $ARGUMENTS`;
    const cmd = parseCommandFile(raw, '/x/pr.md', 'project')!;
    expect(cmd.name).toBe('pr');
    expect(cmd.description).toBe('Create PR');
    expect(cmd.argumentHint).toBe('<base>');
    expect(cmd.allowedTools).toEqual(['Bash', 'Read']);
    expect(cmd.model).toBe('deepseek-chat');
    expect(cmd.body).toBe('body $1 $ARGUMENTS');
    expect(cmd.source).toBe('project');
  });

  it('falls back to first non-empty line as description', () => {
    const raw = `Do the thing.\nMore detail.`;
    const cmd = parseCommandFile(raw, '/x/foo.md', 'user')!;
    expect(cmd.description).toBe('Do the thing.');
    expect(cmd.name).toBe('foo');
  });

  it('name derived from subdir → colon namespace', () => {
    const cmd = parseCommandFile('body', '/root/git/pr.md', 'project', '/root')!;
    expect(cmd.name).toBe('git:pr');
  });

  it('returns null on empty body', () => {
    expect(parseCommandFile('---\ndescription: x\n---\n\n', '/x/e.md', 'user')).toBeNull();
  });
});

describe('expandArguments', () => {
  it('replaces $1 $2 $ARGUMENTS', () => {
    expect(expandArguments('a $1 b $2 c $ARGUMENTS d', 'x y z')).toBe('a x b y c x y z d');
  });

  it('keeps literal when arg missing', () => {
    expect(expandArguments('a $1 b', '')).toBe('a $1 b');
  });

  it('handles $ARGUMENTS alone', () => {
    expect(expandArguments('$ARGUMENTS', 'hello world')).toBe('hello world');
  });
});
