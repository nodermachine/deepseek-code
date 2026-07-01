/**
 * @file 危险命令黑名单
 * 检测已知高危命令模式，包括直接破坏、组合攻击、权限提升等
 */
const PATTERNS: RegExp[] = [
  // 直接破坏性命令
  /\brm\s+-[a-z]*r[a-z]*f[a-z]*\s+\/\s*\*?\s*$/,
  /\brm\s+-[a-z]*f[a-z]*r[a-z]*\s+\/\s*\*?\s*$/,
  // 权限提升
  /^\s*sudo\b/,
  // Fork bomb
  /:\(\)\s*\{[^}]*\|:&[^}]*\}\s*;\s*:/,
  // 组合攻击：远程脚本执行
  /\bcurl\b[^|]*\|\s*(bash|sh|zsh)\b/,
  /\bwget\b[^|]*\|\s*(bash|sh|zsh)\b/,
  /\bcurl\b.*-[a-z]*o\s*-\s*\|\s*(bash|sh|zsh)/,
  /\bwget\b.*-O\s*-\s*\|\s*(bash|sh|zsh)/,
  // Base64 解码执行
  /\bbase64\s+(-d|--decode)\s*\|\s*(bash|sh|eval)/,
  /\becho\b.*\|\s*base64\s+(-d|--decode)\s*\|\s*(bash|sh)/,
  // eval 注入
  /\beval\s+".*\$\(/,
  /\beval\s+'.*\$\(/,
];

export function isDangerous(cmd: string): boolean {
  return PATTERNS.some(p => p.test(cmd));
}

/** 敏感信息模式（用于 Bash 输出过滤） */
const SENSITIVE_PATTERNS: RegExp[] = [
  // API Keys / Tokens
  /(?:api[_-]?key|token|secret|password)\s*[:=]\s*['"]?[A-Za-z0-9_\-]{16,}['"]?/gi,
  // AWS credentials
  /AKIA[0-9A-Z]{16}/g,
  // Private keys
  /-----BEGIN[\s\w]*PRIVATE KEY-----/g,
  // .env 文件内容中的敏感行
  /^[A-Z_]+=(sk-|ghp_|gho_|xoxb-|xoxp-)[^\s]+$/gm,
];

/**
 * 过滤 Bash 输出中的敏感信息，替换为 ***
 */
export function sanitizeOutput(output: string): string {
  let result = output;
  for (const pattern of SENSITIVE_PATTERNS) {
    // 重置 lastIndex（全局模式的 regex 需要）
    pattern.lastIndex = 0;
    result = result.replace(pattern, '***[REDACTED]***');
  }
  return result;
}
