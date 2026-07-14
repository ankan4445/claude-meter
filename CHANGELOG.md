# Changelog

All notable changes to **claude-meter / session-manager** are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)  
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html)

---

## [1.0.0] — 2026-07-01

### Added
- **Session tracking** — `start`, `show`, `end`, `clear`, `resume`, `stats`, `token-breakdown` modes via `/session-manager:meter`
- **Stop hook** (`hooks/record-session-usage.js`) that fires after every Claude turn to accumulate token metrics from the JSONL transcript
- **Token metrics** — input, output, cache read, cache creation tokens per session
- **Cost estimation** — dynamic pricing fetched from LiteLLM with 24h local cache; hardcoded fallback for offline use
- **Cache savings** — reports how much prompt caching saved vs uncached input pricing
- **Activity counters** — turns, tool calls, files modified, bash commands
- **Session archiving** — completed sessions saved to `.claude/sessions/<name>-<id>.json`
- **Session resume** — continue a previously archived session under a new run ID
- **Aggregate stats** — `stats <name>` sums all archived runs for a session name
- **Token breakdown** — per-turn analysis splitting output tokens into thinking / text / tool-call buckets
- **Human-readable session log** — each turn's activity written to `.claude/sessions/logs/<name>-<id>.log`
- **Dynamic pricing** — pricing cache sourced from LiteLLM, refreshed every 24h with a 5s fetch timeout
- Fallback pricing table covering Opus, Sonnet, and Haiku model families (as of 2026-05-11)
- `.gitignore` entry for `.claude/` to prevent session data and transcripts from being committed
- MIT License
