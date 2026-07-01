/**
 * @file Skills 来源解析器
 * 根据用户输入的 URL/包名/路径，自动识别并返回标准化的来源描述
 * 支持：npm 包、GitHub 仓库、HTTP(S) URL、本地路径
 */

/** Skill 来源类型 */
export type SkillSource =
  | { type: 'npm'; package: string }
  | { type: 'github'; owner: string; repo: string; ref?: string }
  | { type: 'url'; url: string }
  | { type: 'local'; path: string };

/**
 * 解析用户输入为标准化的来源描述
 * 判断规则：
 * - ./ 或 / 或 ~ 开头 → local
 * - http:// 或 https:// 开头 → 判断是否 GitHub URL，是则 github，否则 url
 * - github: 前缀 → github
 * - 其余 → npm 包名
 */
export function resolveSource(input: string): SkillSource {
  const trimmed = input.trim();

  // 本地路径：以 ./ 或 / 或 ~ 开头
  if (trimmed.startsWith('./') || trimmed.startsWith('/') || trimmed.startsWith('~')) {
    return { type: 'local', path: trimmed };
  }

  // github: 前缀快捷方式（如 github:user/repo 或 github:user/repo#branch）
  if (trimmed.startsWith('github:')) {
    return parseGithubShorthand(trimmed.slice(7));
  }

  // HTTP(S) URL
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    // 判断是否为 GitHub URL
    const ghMatch = trimmed.match(/^https?:\/\/github\.com\/([^/]+)\/([^/?#]+)/);
    if (ghMatch) {
      const [, owner, rawRepo] = ghMatch;
      const repo = rawRepo.replace(/\.git$/, '');
      // 尝试提取 ref（从 /tree/branch 或 #branch）
      const refMatch = trimmed.match(/\/tree\/([^/?#]+)/);
      return { type: 'github', owner, repo, ref: refMatch?.[1] };
    }
    return { type: 'url', url: trimmed };
  }

  // 其余视为 npm 包名（如 @deepseek-skills/react 或 deepseek-skill-react）
  return { type: 'npm', package: trimmed };
}

/** 解析 github 快捷格式：user/repo 或 user/repo#ref */
function parseGithubShorthand(input: string): SkillSource {
  const [path, ref] = input.split('#');
  const [owner, repo] = path.split('/');
  if (!owner || !repo) {
    // 格式不合法，当作 npm 包处理
    return { type: 'npm', package: `github:${input}` };
  }
  return { type: 'github', owner, repo: repo.replace(/\.git$/, ''), ref: ref || undefined };
}
