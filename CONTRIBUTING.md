# Contributing to claude-meter

Thank you for considering a contribution. This document covers how to report bugs, suggest changes, and submit pull requests.

## Reporting bugs

Open an issue at https://github.com/ankan4445/claude-meter/issues with:
- What you did (command / mode used)
- What you expected to happen
- What actually happened
- Claude Code version (`claude --version`)
- Operating system

## Suggesting enhancements

Open an issue with the label `enhancement`. Describe the use case, not just the feature. Include a concrete example of what the output should look like.

## Development setup

```bash
git clone https://github.com/ankan4445/claude-meter.git
cd claude-meter
node --version   # requires Node.js >= 18
```

No build step required. The hook script is plain Node.js and runs directly.

```bash
# Run the test suite
node tests/run.js
```

## Submitting a pull request

1. Fork the repository and create a branch from `main`:
   ```bash
   git checkout -b fix/your-change
   ```
2. Make your changes. If you modify the hook script, update the pricing fallback table date comment to today's date.
3. Run the tests: `node tests/run.js` — all must pass.
4. Update `CHANGELOG.md` under an `[Unreleased]` section.
5. Open a PR against `main`.

## Coding conventions

- Plain JavaScript (no TypeScript, no transpile step)
- Wrap all file I/O in `try/catch` — the hook must never crash Claude Code
- Do not introduce runtime dependencies; Node.js built-ins only (`fs`, `path`, `https`)
- Keep all pricing data in the fallback table up to date when adding new models

## Pricing table updates

The fallback pricing table in `hooks/record-session-usage.js` is a snapshot. When Anthropic releases new models or changes prices, update both the table and the comment `// sourced from LiteLLM YYYY-MM-DD`.

## License

By contributing, you agree your contributions will be licensed under the [MIT License](LICENSE).
