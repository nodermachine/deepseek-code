<div align="center">

# deepseek-code

**深度适配 DeepSeek 模型的命令行编码 Agent — TypeScript 实现，对标 Claude Code 的开源替代方案。**

[![CI](https://github.com/nodermachine/deepseek-code/actions/workflows/ci.yml/badge.svg)](https://github.com/nodermachine/deepseek-code/actions/workflows/ci.yml)
![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)
![pnpm](https://img.shields.io/badge/pnpm-9-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![TypeScript](https://img.shields.io/badge/TypeScript-5.4-3178C6)
[![English](https://img.shields.io/badge/Docs-English-blue?style=flat)](README.md)

</div>

---

## 概述

`deepseek-code` 是一个强大的命令行编码助手，支持完整的 **读文件 → 改代码 → 跑测试 → 看输出 → 再改** 闭环。它与 DeepSeek API 深度集成，在终端中为你提供自主编码辅助。

项目采用 monorepo 结构，包含三个解耦的包，具备权限控制系统、持久化会话、历史压缩、规划模式以及可扩展的 Skill/Hook 架构。

---

## 为什么选择 deepseek-code？

| | deepseek-code | Claude Code |
|---|---|---|
| 💰 **成本** | DeepSeek API 仅约 Claude 的 **1/30** | Anthropic API 高价 |
| 🔓 **开源** | ✅ MIT 协议，完全开源 | ❌ 闭源 |
| 🔧 **模型选择** | DeepSeek + 任意兼容 OpenAI 的 API | 仅限 Claude |
| 🧠 **推理模型** | 原生支持 `deepseek-reasoner` | 不支持 |
| 🏗️ **架构** | 模块化 monorepo（core/tools/cli） | 单体架构 |
| 🛡️ **权限** | 三层体系 + 前缀记忆 + 黑名单 | 二元允许/拒绝 |
| 🔌 **可扩展** | Skills + Hooks + MCP 客户端 | 有限的插件 |
| 📦 **会话** | 磁盘持久化，支持恢复和压缩 | 仅内存 |
| 🌐 **网页抓取** | 内置 HTML→文本工具 | ❌ 不支持 |

> **一句话**：如果你想要一个开源、低成本、隐私优先的编码 Agent，支持 DeepSeek 和任意 OpenAI 兼容 API，完全可定制且尊重你的隐私 — `deepseek-code` 就是你的选择。

---

## 功能特性

- 🤖 **自主 Agent 循环** — 自动编排工具调用，支持多步推理
- 🔧 **9 个内置工具** — Read、Grep、Glob、Edit、**MultiEdit**、Write、Bash、WebFetch、TodoWrite
- 🛡️ **三层权限系统** — 会话级记忆、项目级规则、用户级配置
- 💬 **交互式 REPL** — 基于 Ink 的丰富 TUI，支持斜杠命令和 Tab 补全
- 📝 **持久化会话** — 磁盘存储，支持 `--resume` 恢复对话
- ⚡ **并行工具执行** — 兼容工具可并行运行，大幅提升效率
- 📦 **历史压缩** — 自动管理上下文窗口，防止 token 溢出
- 📋 **规划模式** — 先生成计划，确认后再执行
- 🧠 **记忆系统** — `DEEPSEEK.md` 规则文件（支持用户级和项目级）
- 🔌 **可扩展** — Skills 系统、Hooks 钩子和 MCP 客户端集成
- 🐚 **智能 Bash 防护** — 危险命令黑名单，基于前缀的权限记忆
- 🌐 **网页抓取** — 抓取网页内容并转为纯文本

## 安装

### 环境要求

- **Node.js** 20+
- **pnpm** 9+（`npm install -g pnpm@9`）
- **ripgrep**（macOS：`brew install ripgrep`，Ubuntu：`apt install ripgrep`）

### 安装步骤

```bash
# 克隆仓库
git clone https://github.com/nodermachine/deepseek-code.git
cd deepseek-code

# 安装依赖并构建
pnpm install
pnpm -r build

# （可选）全局链接
pnpm -w link --global
```

## 快速开始

### 登录

```bash
deepseek login
# 粘贴你的 DeepSeek API key（sk-...）
```

配置信息保存到 `~/.deepseek-code/config.json`：

```json
{
  "apiKey": "sk-...",
  "model": "deepseek-chat",
  "baseUrl": "https://api.deepseek.com/v1",
  "bashTimeoutMs": 30000,
  "maxSteps": 50
}
```

### 使用方式

#### 单次任务

```bash
deepseek "帮我修一下 src/foo.ts 里的拼写错误，然后跑 vitest"
```

#### 交互式 REPL

```bash
deepseek
> 列出当前目录有哪些 TypeScript 文件
> 修一下 README 里的拼写错误
> /model deepseek-reasoner   # 运行时切换模型
> /plan 重构数据库模块       # 进入规划模式
```

#### 会话管理

```bash
deepseek sessions               # 列出所有历史会话
deepseek --resume <id>          # 恢复指定会话
deepseek sessions rm <id>       # 删除会话
```

## REPL 斜杠命令

输入 `/` 时自动显示命令建议，支持 Tab 补全：

| 命令 | 说明 |
|------|------|
| `/help` | 显示可用命令列表 |
| `/model [name]` | 查看或切换模型 |
| `/plan <prompt>` | 进入规划模式（先生成计划再执行） |
| `/clear` | 清空当前会话历史 |
| `/sessions` | 列出历史会话 |
| `/compact` | 手动触发历史压缩 |
| `/quit` | 退出 REPL |

## 支持的工具（9 个）

| 工具 | 说明 | 权限 |
|------|------|------|
| **Read** | 读文件（cat -n 风格，支持分页） | 自动放行 |
| **Grep** | ripgrep 包装（正则/glob/上下文） | 自动放行 |
| **Glob** | 按模式匹配文件路径 | 自动放行 |
| **Edit** | 精确字符串替换（需先 Read） | 首次询问 |
| **MultiEdit** | 批量多文件原子性替换 | 首次询问 |
| **Write** | 整文件写入 | 首次询问 |
| **Bash** | 执行 shell 命令（30s 超时） | 按命令前缀询问 |
| **WebFetch** | 抓取网页内容（HTML→纯文本） | 首次询问 |
| **TodoWrite** | 会话级任务清单管理 | 自动放行 |

## 权限模型

三层规则（优先级从高到低）：

1. **会话级记忆** — 用户本次会话中选择后自动记住
2. **项目级** — `.deepseek-code/permissions.json`
3. **用户级** — `~/.deepseek-code/permissions.json`

特殊机制：

- **Bash 前缀匹配**：`git status -s` → 记住 `git status` 前缀，后续相同前缀命令不再询问
- **硬黑名单**：`rm -rf /`、`sudo`、fork bomb — 直接拒绝，无法放行

询问时按键：

- `a` 仅本次允许 / `A` 本会话允许
- `d` 仅本次拒绝 / `D` 本会话拒绝

## Memory（DEEPSEEK.md）

类似 Claude 的 `CLAUDE.md`，你可以创建规则文件让 Agent 始终遵循：

- **用户级**：`~/.deepseek-code/DEEPSEEK.md`（所有项目生效）
- **项目级**：`<项目根>/DEEPSEEK.md` 或 `<项目根>/.deepseek-code/DEEPSEEK.md`

示例内容：

```markdown
# 编码规范
- 所有代码必须加注释
- 使用 TypeScript strict 模式
- 提交前必须通过 pnpm test
```

## 命令行选项

| flag | 说明 |
|------|------|
| `--model <name>` | 覆盖默认模型（如 `deepseek-reasoner`，自动停用工具调用） |
| `--debug` | 写入 JSONL 日志到 `~/.deepseek-code/logs/` |
| `--cwd <path>` | 切换工作目录 |
| `--resume <id>` | 恢复指定会话继续对话 |
| `--plan` | 规划模式：先生成计划，确认后再执行 |
| `--no-tui` | 禁用 Ink TUI，使用纯文本输出 |

## 架构

```
packages/
├── core/      # 核心运行时（Agent Loop、Provider、权限、Session、Memory、Compact、Skills、Hooks、MCP）
├── tools/     # 9 个内置工具（与 core 解耦）
└── cli/       # 命令行入口（REPL、渲染、Ink TUI、权限提示）
```

模块边界规则：

- `core` 不依赖 `cli`，所有 IO 通过依赖注入
- `tools` 依赖 `core` 的工具接口，工具之间互不依赖
- `cli` 是唯一持有 process IO 的层

## 开发

```bash
pnpm test              # 全部测试 + 覆盖率
pnpm -r typecheck      # 类型检查
pnpm -r build          # 编译
```

### 项目包说明

| 包名 | 说明 |
|------|------|
| `@deepseek-code/core` | 核心运行时：Agent 循环、Provider、权限引擎、会话存储、记忆加载、Skill 系统、Hooks、MCP 客户端 |
| `@deepseek-code/tools` | 9 个内置工具：Read、Grep、Glob、Edit、MultiEdit、Write、Bash、WebFetch、TodoWrite |
| `deepseek-code` (CLI) | 入口点：commander CLI、REPL、Ink TUI、渲染器 |

## 路线图

- **v0.1** — 单 agent loop + 5 工具 + 三态权限 + 内存 session
- **v0.2** — Ink TUI + 持久 session + 历史压缩 + Memory + Plan mode + 3 新工具 + 斜杠命令
- **v0.3**（当前）— Skills 系统 + Hooks + MCP 客户端 + 工具并行执行
- **v0.4+** — Sub-agent 并行 + Plugin 体系

## 许可

MIT
