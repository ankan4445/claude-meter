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

## Prerequisites

This plugin runs inside [Claude Code](https://code.claude.com/docs/en/quickstart).
If you don't already have the Claude Code terminal installed, install it first:

```bash
npm install -g @anthropic-ai/claude-code
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

### First time in a project: run `init`

The **first time** you use the plugin in a project, you **must** run `init`. This
registers the token-tracking `Stop` hook in the project. Without it, the hook is
never wired up, so token metrics won't be recorded (time and activity still are).

```bash
/session-manager init
```

You only need to do this once per project.

### Example flow

A typical tracked session, from start to finish:

```bash
# 1. Begin a new session with a label
/session-manager start "xyz"

# 2. Check live metrics at any point while you work
/session-manager show

# 3. Stop tracking and print the final report
/session-manager end
```

Later, pick the session back up and inspect aggregate numbers:

```bash
# 4. Continue the previously archived session
/session-manager resume "xyz"

# 5. Aggregate all archived runs for that name
/session-manager stats "xyz"
```

## How it works

- Session state lives in `.claude/sessions/active.json`.
- The `Stop` hook (`.claude/hooks/record-session-usage.js`) fires after every
  turn to accumulate token data.
- Ending or clearing a session archives it to
  `.claude/sessions/<name>-<id>.json`.
