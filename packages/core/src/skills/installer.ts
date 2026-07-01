/**
 * @file Skills 安装器核心
 * 根据解析后的来源类型执行不同的安装策略：
 * - npm: npm pack → 解压 → 复制 .md
 * - github: git clone --depth=1 → 复制 .md
 * - url: fetch → 写入
 * - local: 复制文件
 */
import { mkdirSync, existsSync, copyFileSync, writeFileSync, readdirSync, rmSync, readFileSync, statSync } from 'node:fs';
import { join, basename, resolve, dirname, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { resolveSource, type SkillSource } from './resolver.js';
import { addEntry } from './manifest.js';

export interface InstallOpts {
  /** 用户原始输入（URL/包名/路径） */
  source: string;
  /** 目标 skills 目录（绝对路径） */
  targetDir: string;
}

export interface InstallResult {
  /** 包名（用于 manifest key） */
  name: string;
  /** 安装到目标目录的文件列表 */
  files: string[];
  /** 解析后的来源 */
  source: SkillSource;
}

/**
 * 安装 Skill 到指定目录
 * 自动解析来源类型，下载/复制文件，记录到 .installed.json
 */
export async function installSkill(opts: InstallOpts): Promise<InstallResult> {
  const { source, targetDir } = opts;
  const parsed = resolveSource(source);

  // 确保目标目录存在
  mkdirSync(targetDir, { recursive: true });

  let result: InstallResult;

  switch (parsed.type) {
    case 'local':
      result = installFromLocal(parsed, targetDir, source);
      break;
    case 'url':
      result = await installFromUrl(parsed, targetDir, source);
      break;
    case 'github':
      result = installFromGithub(parsed, targetDir, source);
      break;
    case 'npm':
      result = installFromNpm(parsed, targetDir, source);
      break;
  }

  // 记录到 manifest
  addEntry(targetDir, result.name, {
    source,
    sourceType: parsed.type,
    installedAt: new Date().toISOString(),
    files: result.files,
  });

  return result;
}

/** 从本地路径安装（复制文件或目录，保持目录结构） */
function installFromLocal(src: SkillSource & { type: 'local' }, targetDir: string, rawSource: string): InstallResult {
  const srcPath = resolve(src.path);
  const files: string[] = [];
  const name = basename(srcPath, '.md');
  // 安装到 skills/<name>/ 子目录
  const skillDir = join(targetDir, name);
  mkdirSync(skillDir, { recursive: true });

  if (srcPath.endsWith('.md') && isFile(srcPath)) {
    // 单个文件
    const fileName = basename(srcPath);
    copyFileSync(srcPath, join(skillDir, fileName));
    files.push(join(name, fileName));
  } else if (existsSync(srcPath)) {
    // 目录：确定源目录（skills/ 或根目录）并保持结构复制
    const baseDir = findBaseDir(srcPath);
    copyDirRecursive(baseDir, skillDir, files, name);
  }

  return { name, files, source: { type: 'local', path: src.path } };
}

/** 从 HTTP URL 安装（fetch 下载单个 .md 文件） */
async function installFromUrl(src: SkillSource & { type: 'url' }, targetDir: string, rawSource: string): Promise<InstallResult> {
  const resp = await fetch(src.url);
  if (!resp.ok) throw new Error(`下载失败: HTTP ${resp.status} - ${src.url}`);
  const content = await resp.text();

  // 从 URL 提取文件名
  const urlPath = new URL(src.url).pathname;
  let fileName = basename(urlPath);
  if (!fileName.endsWith('.md')) fileName += '.md';

  writeFileSync(join(targetDir, fileName), content);
  const name = basename(fileName, '.md');
  return { name, files: [fileName], source: src };
}

/** 从 GitHub 安装（git clone --depth=1，保持目录结构） */
function installFromGithub(src: SkillSource & { type: 'github' }, targetDir: string, rawSource: string): InstallResult {
  const tmpDir = join(tmpdir(), `deepseek-skill-${Date.now()}`);
  const repoUrl = `https://github.com/${src.owner}/${src.repo}.git`;

  try {
    // shallow clone
    const cloneCmd = src.ref
      ? `git clone --depth=1 --branch ${src.ref} ${repoUrl} ${tmpDir}`
      : `git clone --depth=1 ${repoUrl} ${tmpDir}`;
    execSync(cloneCmd, { stdio: 'pipe' });

    const baseDir = findBaseDir(tmpDir);
    const hasSkillsDir = existsSync(join(tmpDir, 'skills'));

    // 如果仓库有 skills/ 目录，直接把 skills/ 下的内容复制到 targetDir（保持子目录结构）
    // 否则用 owner--repo 作为包目录
    const pkgName = hasSkillsDir ? src.repo : `${src.owner}--${src.repo}`;
    const destDir = hasSkillsDir ? targetDir : join(targetDir, pkgName);
    mkdirSync(destDir, { recursive: true });

    const files: string[] = [];
    // 包名前缀：有 skills/ 时用空前缀（因为子目录已是包名），否则用 pkgName
    const prefix = hasSkillsDir ? '' : pkgName;
    copyDirRecursive(baseDir, destDir, files, prefix);

    return { name: pkgName, files, source: src };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** 确定收集文件的基准目录（skills/ 子目录或根目录） */
function findBaseDir(dir: string): string {
  const skillsDir = join(dir, 'skills');
  if (existsSync(skillsDir)) return skillsDir;
  return dir;
}

/** 从 npm 安装（npm pack → 解压 → 复制，保持目录结构） */
function installFromNpm(src: SkillSource & { type: 'npm' }, targetDir: string, rawSource: string): InstallResult {
  const tmpDir = join(tmpdir(), `deepseek-skill-npm-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });

  try {
    // npm pack 下载 tgz
    execSync(`npm pack ${src.package} --pack-destination=${tmpDir}`, { stdio: 'pipe', cwd: tmpDir });

    // 找到下载的 tgz 文件
    const tgzFiles = readdirSync(tmpDir).filter(f => f.endsWith('.tgz'));
    if (tgzFiles.length === 0) throw new Error(`npm pack 未生成文件: ${src.package}`);

    // 解压 tgz
    const extractDir = join(tmpDir, 'extracted');
    mkdirSync(extractDir);
    execSync(`tar -xzf ${join(tmpDir, tgzFiles[0])} -C ${extractDir}`, { stdio: 'pipe' });

    // npm pack 解压后在 package/ 目录下
    const pkgDir = join(extractDir, 'package');

    // 尝试读取 package.json 获取名称
    const pkgJsonPath = join(pkgDir, 'package.json');
    let name = src.package.replace(/^@[^/]+\//, ''); // 去掉 scope
    if (existsSync(pkgJsonPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
        name = pkg.name?.replace(/^@[^/]+\//, '') ?? name;
      } catch { /* ignore */ }
    }

    // 确定源目录并复制到 skills/<name>/
    const baseDir = findBaseDir(pkgDir);
    const skillDir = join(targetDir, name);
    mkdirSync(skillDir, { recursive: true });

    const files: string[] = [];
    copyDirRecursive(baseDir, skillDir, files, name);

    return { name, files, source: src };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * 递归复制目录中的 .md 文件，保持目录结构
 * @param srcDir 源目录
 * @param destDir 目标目录
 * @param files 收集已复制的相对路径列表
 * @param prefix 文件路径前缀（用于 manifest 记录）
 */
function copyDirRecursive(srcDir: string, destDir: string, files: string[], prefix: string): void {
  const entries = readdirSync(srcDir);
  for (const entry of entries) {
    // 跳过隐藏文件、node_modules、scripts
    if (entry.startsWith('.') || entry === 'node_modules') continue;
    const srcPath = join(srcDir, entry);
    const destPath = join(destDir, entry);

    if (isFile(srcPath)) {
      if (entry.endsWith('.md') && entry.toLowerCase() !== 'readme.md') {
        copyFileSync(srcPath, destPath);
        files.push(prefix ? join(prefix, entry) : entry);
      }
    } else if (statSync(srcPath).isDirectory()) {
      mkdirSync(destPath, { recursive: true });
      copyDirRecursive(srcPath, destPath, files, prefix ? join(prefix, entry) : entry);
    }
  }
}

/** 判断路径是否是文件 */
function isFile(path: string): boolean {
  try { return statSync(path).isFile(); } catch { return false; }
}
