---
description: Track token usage, cost, time, and activity per Claude Code session.
argument-hint: "[init|start|show|end|clear|resume|stats|token-breakdown] [name]"
---

# Session Manager

You are running the **session-manager** workflow. The full behaviour for every
mode (state files, node scripts, output formats, hooks) is defined in the
`session-manager` skill at `skills/session-manager/SKILL.md`.
Read that skill and follow it exactly.

Argument passed by the user: `$ARGUMENTS`

## Routing

- If `$ARGUMENTS` is empty, present the menu below and wait for a choice.
- Otherwise, treat the first word as the mode and the rest as its argument,
  then execute that mode directly per the skill.

> **What would you like to do?**
>
> 1. **init** — Re-check token tracking (optional; the hook is auto-registered)
> 2. **start [label]** — Begin a new tracked session
> 3. **show** — Display metrics for the current session
> 4. **end** — Stop tracking and show the final report
> 5. **clear** — Archive current session, start a fresh one
> 6. **resume \<name\>** — Continue a previously archived session
> 7. **stats \<name\>** — Aggregate all archived sessions for a name
> 8. **token-breakdown \[name\]** — Analyse where tokens were spent
>
> Reply with 1–8 or a keyword.
