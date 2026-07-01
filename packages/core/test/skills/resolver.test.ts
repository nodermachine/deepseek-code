/**
 * @file Skills 来源解析器测试
 * 验证 resolveSource 对各种输入格式的正确解析
 */
import { describe, it, expect } from 'vitest';
import { resolveSource } from '../../src/skills/resolver.js';

describe('resolveSource', () => {
  // --- 本地路径 ---
  it('resolves relative path as local', () => {
    expect(resolveSource('./my-skill.md')).toEqual({ type: 'local', path: './my-skill.md' });
  });

  it('resolves absolute path as local', () => {
    expect(resolveSource('/tmp/skills/test.md')).toEqual({ type: 'local', path: '/tmp/skills/test.md' });
  });

  it('resolves ~ path as local', () => {
    expect(resolveSource('~/skills/foo.md')).toEqual({ type: 'local', path: '~/skills/foo.md' });
  });

  // --- GitHub 快捷方式 ---
  it('resolves github: prefix', () => {
    expect(resolveSource('github:user/repo')).toEqual({ type: 'github', owner: 'user', repo: 'repo', ref: undefined });
  });

  it('resolves github: with ref', () => {
    expect(resolveSource('github:user/repo#main')).toEqual({ type: 'github', owner: 'user', repo: 'repo', ref: 'main' });
  });

  it('resolves github: strips .git suffix', () => {
    expect(resolveSource('github:user/repo.git')).toEqual({ type: 'github', owner: 'user', repo: 'repo', ref: undefined });
  });

  // --- GitHub URL ---
  it('resolves https://github.com URL as github', () => {
    expect(resolveSource('https://github.com/user/my-repo')).toEqual({
      type: 'github', owner: 'user', repo: 'my-repo', ref: undefined,
    });
  });

  it('resolves GitHub URL with .git suffix', () => {
    expect(resolveSource('https://github.com/user/repo.git')).toEqual({
      type: 'github', owner: 'user', repo: 'repo', ref: undefined,
    });
  });

  it('resolves GitHub URL with /tree/branch', () => {
    expect(resolveSource('https://github.com/user/repo/tree/dev')).toEqual({
      type: 'github', owner: 'user', repo: 'repo', ref: 'dev',
    });
  });

  // --- HTTP URL (非 GitHub) ---
  it('resolves generic https URL', () => {
    expect(resolveSource('https://example.com/skills/test.md')).toEqual({
      type: 'url', url: 'https://example.com/skills/test.md',
    });
  });

  it('resolves http URL', () => {
    expect(resolveSource('http://localhost:3000/skill.md')).toEqual({
      type: 'url', url: 'http://localhost:3000/skill.md',
    });
  });

  // --- npm 包名 ---
  it('resolves scoped npm package', () => {
    expect(resolveSource('@deepseek-skills/react')).toEqual({ type: 'npm', package: '@deepseek-skills/react' });
  });

  it('resolves plain npm package', () => {
    expect(resolveSource('deepseek-skill-react')).toEqual({ type: 'npm', package: 'deepseek-skill-react' });
  });

  // --- 边界 ---
  it('trims whitespace', () => {
    expect(resolveSource('  ./foo.md  ')).toEqual({ type: 'local', path: './foo.md' });
  });
});
