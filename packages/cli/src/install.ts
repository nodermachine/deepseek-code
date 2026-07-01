/**
 * @file CLI install/uninstall 子命令
 * 支持从多种来源安装 Skills：npm/GitHub/URL/本地路径
 * 安装时用 radio 选择器询问用户安装范围（项目级/全局）
 */
import { join } from 'node:path';
import { homedir } from 'node:os';
import pc from 'picocolors';
import { select } from '@inquirer/prompts';
import { installSkill } from '@deepseek-code/core';
import { removeEntry, readManifest } from '@deepseek-code/core';

/**
 * 交互式选择安装范围（radio 风格）
 * 用户通过上下键选择，回车确认
 */
async function askScope(): Promise<{ dir: string; label: string }> {
  const answer = await select({
    message: '安装范围',
    choices: [
      {
        name: '项目级  .deepseek-code/skills/ （仅当前项目）',
        value: 'project',
      },
      {
        name: '全局    ~/.deepseek-code/skills/ （所有项目共享）',
        value: 'global',
      },
    ],
    default: 'project',
  });

  if (answer === 'global') {
    return { dir: join(homedir(), '.deepseek-code', 'skills'), label: '全局' };
  }
  return { dir: join(process.cwd(), '.deepseek-code', 'skills'), label: '项目级' };
}

/**
 * 处理 deepseek install <source> 命令
 * 交互式询问安装范围，然后执行安装
 */
export async function handleInstall(argv: string[]): Promise<number> {
  // 提取 source：install 后面的第一个非 flag 参数
  const installIdx = argv.indexOf('install');
  const args = argv.slice(installIdx + 1).filter(a => !a.startsWith('-'));

  if (args.length === 0) {
    process.stderr.write(pc.red('用法: deepseek install <source>\n'));
    process.stderr.write(pc.gray(`
示例:
  deepseek install ./my-skill.md              # 本地文件
  deepseek install github:user/repo           # GitHub 仓库
  deepseek install https://example.com/s.md   # URL 下载
  deepseek install @deepseek-skills/react     # npm 包
`));
    return 1;
  }

  const source = args[0];

  // 交互式询问安装范围
  const { dir: targetDir, label: scope } = await askScope();
  process.stdout.write(`\n正在安装到${scope}: ${pc.cyan(source)}\n`);

  try {
    const result = await installSkill({ source, targetDir });
    process.stdout.write(pc.green(`\n✓ 已安装 "${result.name}"（${result.files.length} 个文件）\n`));
    for (const f of result.files) {
      process.stdout.write(`  ${pc.dim(f)}\n`);
    }
    process.stdout.write(pc.gray(`\n目标目录: ${targetDir}\n`));
    return 0;
  } catch (e: any) {
    process.stderr.write(pc.red(`\n✗ 安装失败: ${e.message}\n`));
    return 1;
  }
}

/**
 * 处理 deepseek uninstall <name> 命令
 * 交互式询问卸载范围
 */
export async function handleUninstall(argv: string[]): Promise<number> {
  const unIdx = argv.indexOf('uninstall');
  const args = argv.slice(unIdx + 1).filter(a => !a.startsWith('-'));

  if (args.length === 0) {
    process.stderr.write(pc.red('用法: deepseek uninstall <name>\n'));
    return 1;
  }

  const name = args[0];

  // 交互式询问范围
  const { dir: targetDir } = await askScope();

  const { removed, files } = removeEntry(targetDir, name);
  if (!removed) {
    const manifest = readManifest(targetDir);
    const names = Object.keys(manifest);
    process.stderr.write(pc.red(`未找到已安装的 skill: "${name}"\n`));
    if (names.length > 0) {
      process.stderr.write(pc.gray(`已安装的: ${names.join(', ')}\n`));
    }
    return 1;
  }

  process.stdout.write(pc.green(`✓ 已卸载 "${name}"（删除 ${files.length} 个文件）\n`));
  for (const f of files) {
    process.stdout.write(`  ${pc.dim(f)}\n`);
  }
  return 0;
}
