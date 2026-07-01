# Contributing to deepseek-code

Thank you for considering contributing to deepseek-code! We welcome contributions of all kinds.

## Code of Conduct

Be respectful, constructive, and inclusive. We aim to maintain a positive community.

## Development Setup

```bash
# Fork and clone the repo
git clone https://github.com/YOUR_USERNAME/deepseek-code.git
cd deepseek-code

# Install dependencies
pnpm install

# Build all packages
pnpm -r build

# Run tests
pnpm test
```

## Project Structure

```
packages/
├── core/      # Core runtime — no I/O dependencies
├── tools/     # Built-in tools — depend on core interfaces
└── cli/       # CLI entry — only layer with process I/O
```

## Development Workflow

1. **Create a branch**: `git checkout -b feat/your-feature`
2. **Make changes**: Follow the module boundary rules (core → tools → cli)
3. **Type check**: `pnpm -r typecheck`
4. **Run tests**: `pnpm test` (ensure coverage thresholds pass)
5. **Commit**: Use clear commit messages
6. **Push and open a PR**

## Coding Guidelines

- Write TypeScript in strict mode
- Keep modules decoupled — core should never import from cli
- Add JSDoc comments for public APIs
- Ensure all new code has corresponding tests
- Maintain 80%+ coverage thresholds

## Pull Request Process

1. Ensure all CI checks pass
2. Update documentation if adding/changing features
3. Add or update tests as needed
4. Request review from maintainers

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
