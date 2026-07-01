# claude-meter / session-manager

[![CI](https://github.com/ankan4445/claude-meter/actions/workflows/ci.yml/badge.svg)](https://github.com/ankan4445/claude-meter/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js ≥18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)

> **Naming note:** `claude-meter` is the marketplace/repository name. `session-manager` is the plugin installed from it. The slash command is `/session-manager:meter`.

A Claude Code plugin that tracks **token usage, cost, time, and activity** per session.
It provides a `/session-manager:meter` slash command (plus a matching skill for
natural-language triggers) and a `Stop` hook that accumulates token metrics after
every turn.

## What it tracks

- Token counts — input, output, cache read, cache creation
- Estimated cost
- Turn count, tool calls, files modified
- Elapsed time per session
- Per-session archiving, stats, and token breakdown (thinking / replies / tools)

## Prerequisites

This plugin runs inside [Claude Code](https://code.claude.com/docs/en/quickstart).
If you don't already have the Claude Code terminal installed, install it first.

**With npm:**

```bash
npm install -g @anthropic-ai/claude-code
```

**Without npm (native installer):**

- macOS / Linux:

  ```bash
  curl -fsSL https://claude.ai/install.sh | bash
  ```
- Windows (PowerShell):

  ```powershell
  irm https://claude.ai/install.ps1 | iex
  ```

Then launch it from your project directory:

```bash
claude
```

See the [Claude Code quickstart](https://code.claude.com/docs/en/quickstart) for
full setup and authentication instructions.

## Installation

This plugin is distributed through a Claude Code marketplace.

1. Add the marketplace (point it at this repo):

   ```bash
   /plugin marketplace add ankan4445/claude-meter
   ```

   You can also point it at the full URL or a local clone:

   ```bash
   /plugin marketplace add https://github.com/ankan4445/claude-meter
   /plugin marketplace add /path/to/local/clone
   ```
2. Install the plugin from the `claude-meter` marketplace:

   ```bash
   /plugin install session-manager@claude-meter
   ```
3. Start a session — the token-tracking Stop hook is registered automatically:

   ```bash
   /session-manager:meter start
   ```

> Token tracking works out of the box; no manual hook setup is needed.

### Managing the marketplace

```bash
/plugin marketplace list                # list configured marketplaces
/plugin marketplace update claude-meter # pull the latest plugin version
/plugin marketplace remove claude-meter # remove the marketplace
```

## Usage

Type `/session-manager:meter` in the Claude Code chat. Invoke it with no argument
to open the menu, or pass a mode directly:

| Mode                       | Description                                 |
| -------------------------- | ------------------------------------------- |
| `start [label]`          | Begin a new tracked session                 |
| `show`                   | Display metrics for the current session     |
| `end`                    | Stop tracking and show the final report     |
| `clear`                  | Archive the current session and start fresh |
| `resume <name>`          | Continue a previously archived session      |
| `stats <name>`           | Aggregate all archived sessions for a name  |
| `token-breakdown [name]` | Analyse where tokens were spent             |

### Example flow

A typical tracked session, from start to finish:

```bash
# 1. Begin a new session with a label
/session-manager:meter start "xyz"

# 2. Check live metrics at any point while you work
/session-manager:meter show

# 3. Stop tracking and print the final report
/session-manager:meter end
```

Later, pick the session back up and inspect aggregate numbers:

```bash
# 4. Continue the previously archived session
/session-manager:meter resume "xyz"

# 5. Aggregate all archived runs for that name
/session-manager:meter stats "xyz"
```

## How it works

- Session state lives in `.claude/sessions/active.json`.
- The plugin's `Stop` hook (registered via `hooks/hooks.json`) fires after every
  turn to accumulate token data.
- Ending or clearing a session archives it to
  `.claude/sessions/<name>-<id>.json`.
- Pricing is fetched from the [LiteLLM model pricing list](https://github.com/BerriAI/litellm) on first use and cached locally for 24 hours. If the fetch fails or is blocked by a firewall, a hardcoded fallback table is used — no session data is ever sent externally.

## Troubleshooting

**Tokens show as `0` or `—` after a turn**

The Stop hook isn't firing. Run `/session-manager:meter init` to check status, then try `/reload-plugins`. Do **not** add the hook manually to `.claude/settings.json` — that would double-count tokens.

**Cost estimate looks wrong**

The plugin uses the model ID from your transcript. If your model isn't in the fallback pricing table, it falls back to `claude-sonnet-4-6` rates. Check `.claude/sessions/pricing-cache.json` to see what rates are loaded.

**Session data not appearing after `/clear`**

The transcript path updates on the first turn of the new chat. Run one prompt after `/clear`, then check `/session-manager:meter show`.

**`active.json` is missing**

No session has been started in this project. Run `/session-manager:meter start` first.

**Behind a corporate firewall (pricing fetch blocked)**

The pricing fetch to `raw.githubusercontent.com` will time out after 5 seconds and fall back to the hardcoded table. No action needed — session tracking still works fully.

