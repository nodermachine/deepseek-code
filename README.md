<div align="center">

# deepseek-code

**A CLI coding agent deeply adapted for DeepSeek models — TypeScript implementation, the open-source alternative to Claude Code.**

[![CI](https://github.com/nodermachine/deepseek-code/actions/workflows/ci.yml/badge.svg)](https://github.com/nodermachine/deepseek-code/actions/workflows/ci.yml)
![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)
![pnpm](https://img.shields.io/badge/pnpm-9-blue)
![License](https://img.shields.io/badge/license-MIT-green)

</div>

---

## Overview

`deepseek-code` is a powerful command-line coding agent that completes the full development loop: **Read → Edit → Test → See output → Iterate**. It integrates deeply with DeepSeek's API to provide an autonomous coding assistant right in your terminal.

Built as a monorepo with three decoupled packages, it features a permission system, persistent sessions, history compression, planning mode, and an extensible skill/hook architecture.

## Features

- 🤖 **Autonomous Agent Loop** — Automatic tool orchestration with multi-step reasoning
- 🔧 **8 Built-in Tools** — Read, Grep, Glob, Edit, Write, Bash, WebFetch, TodoWrite
- 🛡️ **3-Tier Permission System** — Session-level memory, project-level rules, user-level config
- 💬 **Interactive REPL** — Rich TUI with Ink, slash commands, and Tab completion
- 📝 **Persistent Sessions** — Disk-backed session storage with `--resume` support
- 📦 **History Compression** — Automatic context window management
- 📋 **Plan Mode** — Generate plans first, confirm, then execute
- 🧠 **Memory System** — `DEEPSEEK.md` rules file (user-level & project-level)
- 🔌 **Extensible** — Skills system, Hooks, and MCP client integration
- 🐚 **Smart Bash Guard** — Dangerous command blacklist, prefix-based permission memory
- 🌐 **Web Fetch** — Fetch web content and convert HTML to plain text

## Installation

### Prerequisites

- **Node.js** 20+
- **pnpm** 9+ (`npm install -g pnpm@9`)
- **ripgrep** (`brew install ripgrep` on macOS, `apt install ripgrep` on Ubuntu)

### Setup

```bash
# Clone the repository
git clone https://github.com/nodermachine/deepseek-code.git
cd deepseek-code

# Install dependencies and build
pnpm install
pnpm -r build

# (Optional) Link globally
pnpm -w link --global
```

## Getting Started

### Login

```bash
deepseek login
# Paste your DeepSeek API key (sk-...)
```

Configuration is saved to `~/.deepseek-code/config.json`:

```json
{
  "apiKey": "sk-...",
  "model": "deepseek-chat",
  "baseUrl": "https://api.deepseek.com/v1",
  "bashTimeoutMs": 30000,
  "maxSteps": 50
}
```

### Usage

#### Single Task

```bash
deepseek "Fix the typo in src/foo.ts and run vitest"
```

#### Interactive REPL

```bash
deepseek
> List all TypeScript files in the current directory
> Fix the spelling errors in README
> /model deepseek-reasoner   # Switch model at runtime
> /plan Refactor the database module  # Plan mode
```

#### Session Management

```bash
deepseek sessions               # List all sessions
deepseek --resume <id>          # Resume a session
deepseek sessions rm <id>       # Delete a session
```

## REPL Slash Commands

Type `/` to open a fuzzy-matched command menu. Use ↑↓ to select, Enter/Tab to submit, Esc to close.

| Command | Description |
|---------|-------------|
| `/help` | Show grouped list of all commands |
| `/model [name]` | View or switch model |
| `/plan <prompt>` | Enter plan mode |
| `/clear` | Clear current session history |
| `/sessions` | List historical sessions |
| `/resume <id>` | Switch to another session inside the REPL |
| `/compact` | Manually trigger history compression |
| `/config` | Show effective configuration |
| `/skills` | List available skills |
| `/memory [user]` | Open `DEEPSEEK.md` in `$EDITOR` |
| `/init` | Scaffold `.deepseek-code/commands/` skeleton |
| `/quit` | Exit REPL |

### User-defined commands

Drop Markdown files under `.deepseek-code/commands/` (project) or `~/.deepseek-code/commands/` (user):

```markdown
---
description: Create a PR with a smart summary
argument-hint: <base-branch>
allowed-tools: [Bash, Read, Grep]
model: deepseek-chat
---
Please open a PR against $1. Extra: $ARGUMENTS
```

- `$1 $2 …` = positional args; `$ARGUMENTS` = the full arg string
- Subdirectories become colon namespaces: `commands/git/pr.md` → `/git:pr`
- Priority when names collide: **builtin > project > user > skill**

### Trigger characters

- `@path` — attach a file reference (fuzzy autocomplete over git-tracked + cwd files); the reference is passed to the agent as a `[attached files]` note
- `#text` — append `text` to `DEEPSEEK.md`; a small prompt lets you pick project or user scope, and the system prompt is hot-reloaded

### Keyboard shortcuts

| Key | Behavior |
|---|---|
| ↑ / ↓ | History nav (no menu) / move highlight (menu open) |
| Enter | Submit turn / apply selected suggestion |
| Tab | Apply selected suggestion |
| Esc | Abort current turn / close menu / clear line |
| Ctrl+C | Abort turn or clear line; twice on empty line exits |
| Ctrl+D | Exit on empty line |
| Ctrl+A / E | Cursor to line start / end |
| Ctrl+U / K | Delete to line start / end |
| Ctrl+W | Delete previous word |

## Tools (8)

| Tool | Description | Permission |
|------|-------------|-----------|
| **Read** | Read files (cat -n style, paginated) | Auto-allow |
| **Grep** | ripgrep wrapper (regex, glob, context) | Auto-allow |
| **Glob** | Pattern-based file path matching | Auto-allow |
| **Edit** | Exact string replacement (requires prior Read) | Ask first |
| **Write** | Full file write | Ask first |
| **Bash** | Execute shell commands (30s timeout) | Ask by prefix |
| **WebFetch** | Fetch web content (HTML → plain text) | Ask first |
| **TodoWrite** | Session-level task list management | Auto-allow |

## Permission Model

Three-tier rules (highest priority first):

1. **Session-level** — Auto-remembered from user choices during the session
2. **Project-level** — `.deepseek-code/permissions.json`
3. **User-level** — `~/.deepseek-code/permissions.json`

Special mechanisms:

- **Bash Prefix Matching**: `git status -s` → remembers `git status` prefix; subsequent commands with the same prefix skip prompting
- **Hard Blacklist**: `rm -rf /`, `sudo`, fork bombs — directly rejected, cannot be overridden

Permission prompt keys:

- `a` Allow once / `A` Allow for this session
- `d` Deny once / `D` Deny for this session

## Memory (DEEPSEEK.md)

Similar to Claude's `CLAUDE.md`, create rule files that the agent always follows:

- **User-level**: `~/.deepseek-code/DEEPSEEK.md` (applies to all projects)
- **Project-level**: `<project-root>/DEEPSEEK.md` or `<project-root>/.deepseek-code/DEEPSEEK.md`

Example:

```markdown
# Coding Guidelines
- All code must have comments
- Use TypeScript strict mode
- Must pass pnpm test before commits
```

## CLI Options

| Flag | Description |
|------|-------------|
| `--model <name>` | Override default model (e.g., `deepseek-reasoner`, auto-disables tool calls) |
| `--debug` | Write JSONL logs to `~/.deepseek-code/logs/` |
| `--cwd <path>` | Set working directory |
| `--resume <id>` | Resume a specific session |
| `--plan` | Plan mode: generate plan first, confirm, then execute |
| `--no-tui` | Disable Ink TUI, use plain text output |

## Architecture

```
packages/
├── core/      # Core runtime (Agent Loop, Provider, Permission, Session, Memory, Compact, Skills, Hooks, MCP)
├── tools/     # 8 built-in tools (decoupled from core)
└── cli/       # CLI entry point (REPL, rendering, Ink TUI, permission prompts)
```

Module boundary rules:

- `core` does not depend on `cli`; all I/O is through dependency injection
- `tools` depend on `core`'s tool interfaces; tools don't depend on each other
- `cli` is the only layer that holds process I/O

## Development

```bash
pnpm test              # Run all tests with coverage
pnpm -r typecheck      # Type checking
pnpm -r build          # Compile
```

### Project Structure

| Package | Description |
|---------|-------------|
| `@deepseek-code/core` | Core runtime: agent loop, provider, permission engine, session store, memory loader, skill system, hooks, MCP client |
| `@deepseek-code/tools` | 8 built-in tools: Read, Grep, Glob, Edit, Write, Bash, WebFetch, TodoWrite |
| `deepseek-code` (CLI) | Entry point: commander CLI, REPL, Ink TUI, renderers |

## Roadmap

- **v0.1** — Single agent loop + 5 tools + 3-tier permission + in-memory sessions
- **v0.2** — Ink TUI + persistent sessions + history compression + Memory + Plan mode + 3 new tools + slash commands
- **v0.3** (current) — Skills system + Hooks + MCP client + Tool parallel execution
- **v0.4+** — Sub-agent parallelism + Plugin system

## License

MIT
