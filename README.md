# Session Manager

A Claude Code plugin that tracks **token usage, cost, time, and activity** per session.
It provides a `/session-manager` skill and a `Stop` hook that accumulates token
metrics after every turn.

## What it tracks

- Token counts — input, output, cache read, cache creation
- Estimated cost
- Turn count, tool calls, files modified
- Elapsed time per session
- Per-session archiving, stats, and token breakdown (thinking / replies / tools)

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
3. Wire up the token-tracking Stop hook (required once before first use):

   ```bash
   /session-manager init
   ```

> Without `init`, time and activity are still tracked, but token fields show `—`.

### Managing the marketplace

```bash
/plugin marketplace list                # list configured marketplaces
/plugin marketplace update claude-meter # pull the latest plugin version
/plugin marketplace remove claude-meter # remove the marketplace
```

## Usage

Invoke the skill with no argument to open the menu, or pass a mode directly:

| Mode                       | Description                                     |
| -------------------------- | ----------------------------------------------- |
| `init`                   | Wire up the token-tracking Stop hook (run once) |
| `start [label]`          | Begin a new tracked session                     |
| `show`                   | Display metrics for the current session         |
| `end`                    | Stop tracking and show the final report         |
| `clear`                  | Archive the current session and start fresh     |
| `resume <name>`          | Continue a previously archived session          |
| `stats <name>`           | Aggregate all archived sessions for a name      |
| `token-breakdown [name]` | Analyse where tokens were spent                 |

Examples:

```bash
/session-manager start "refactor-auth"
/session-manager show
/session-manager end
```

## How it works

- Session state lives in `.claude/sessions/active.json`.
- The `Stop` hook (`.claude/hooks/record-session-usage.js`) fires after every
  turn to accumulate token data.
- Ending or clearing a session archives it to
  `.claude/sessions/<name>-<id>.json`.
