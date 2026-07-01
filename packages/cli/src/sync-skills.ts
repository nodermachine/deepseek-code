/**
 * @file sync-skills 子命令
 * 将 ~/.claude/skills/ 目录下的技能同步到 ~/.deepseek-code/skills/
 * 支持多选同步和范围选择（全局/项目级）
 */
import { existsSync, readdirSync, statSync, cpSync, mkdirSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import pc from 'picocolors';
import { checkbox, select, confirm } from '@inquirer/prompts';

/** Claude skills 目录 */
const CLAUDE_SKILLS_DIR = join(homedir(), '.claude', 'skills');

/**
 * 扫描 Claude skills 目录，获取每个 skill 的名称和描述
 */
function scanClaudeSkills(): Array<{ name: string; dir: string; description: string }> {
  if (!existsSync(CLAUDE_SKILLS_DIR)) return [];

  const entries = readdirSync(CLAUDE_SKILLS_DIR);
  const skills: Array<{ name: string; dir: string; description: string }> = [];

  for (const entry of entries) {
    if (entry.startsWith('.')) continue;
    const fullPath = join(CLAUDE_SKILLS_DIR, entry);
    if (!statSync(fullPath).isDirectory()) continue;

    // 尝试从 SKILL.md 提取描述
    let description = '';
    const skillMd = join(fullPath, 'SKILL.md');
    if (existsSync(skillMd)) {
      const content = readFileSync(skillMd, 'utf8');
      const titleMatch = content.match(/^#\s+(.+)$/m);
      description = titleMatch?.[1] ?? '';
    }

    skills.push({ name: entry, dir: fullPath, description });
  }

  return skills;
}

/**
 * 处理 deepseek sync-skills 命令
 */
export async function handleSyncSkills(_argv: string[]): Promise<number> {
  // 1. 扫描 Claude skills
  const skills = scanClaudeSkills();

  if (skills.length === 0) {
    process.stdout.write(pc.yellow('未检测到 ~/.claude/skills/ 目录或其中没有技能\n'));
    return 0;
  }

  process.stdout.write(pc.bold(`\n检测到 ~/.claude/skills/ 下有 ${skills.length} 个技能：\n\n`));

  // 2. 多选让用户选择要同步的 skills
  const selected = await checkbox({
    message: '选择要同步的技能',
    choices: skills.map(s => ({
      name: `${s.name.padEnd(20)} ${pc.dim(s.description)}`,
      value: s.name,
      checked: true, // 默认全选
    })),
  });

  if (selected.length === 0) {
    process.stdout.write(pc.gray('未选择任何技能，退出\n'));
    return 0;
  }

  // 3. 选择同步目标
  const scope = await select({
    message: '同步目标',
    choices: [
      { name: '全局    ~/.deepseek-code/skills/ （所有项目共享）', value: 'global' },
      { name: '项目级  .deepseek-code/skills/ （仅当前项目）', value: 'project' },
    ],
    default: 'global',
  });

  const targetDir = scope === 'global'
    ? join(homedir(), '.deepseek-code', 'skills')
    : join(process.cwd(), '.deepseek-code', 'skills');

  // 4. 执行同步
  mkdirSync(targetDir, { recursive: true });
  let synced = 0;

  for (const name of selected) {
    const skill = skills.find(s => s.name === name)!;
    const dest = join(targetDir, name);

    // 如果已存在，询问是否覆盖
    if (existsSync(dest)) {
      const overwrite = await confirm({
        message: `${name} 已存在，是否覆盖？`,
        default: true,
      });
      if (!overwrite) {
        process.stdout.write(pc.gray(`  跳过 ${name}\n`));
        continue;
      }
    }

    // 递归复制
    cpSync(skill.dir, dest, { recursive: true, force: true });
    synced++;
    process.stdout.write(`  ${pc.green('✓')} ${name}\n`);
  }

  process.stdout.write(pc.green(`\n✓ 已同步 ${synced} 个技能到 ${targetDir}\n`));
  return 0;
}
