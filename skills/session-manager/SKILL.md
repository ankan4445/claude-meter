---
name: session-manager
description: >
  Create a new tracked session before starting a task, then record and display
  usage metrics — token counts (input, output, cache read, cache creation),
  estimated cost, turn count, tool calls, files modified, and elapsed time.
  Triggers on "start session", "track this session", "show session metrics",
  "session usage", "token usage", "how many tokens", "clear session",
  "reset session", "resume session", "continue session", "token breakdown",
  "where did tokens go", "token analysis", or any request to begin metric
  tracking, display/reset/restart a session, continue a previously archived
  session, or analyse token usage by category.
---

# Session Metrics

Track a Claude Code session from start to finish, capturing token usage,
cost estimate, turn count, tool activity, and elapsed time. All state is
written to `.claude/sessions/active.json`; a Stop hook accumulates token
data after every turn.

---

## Modes

If the user invokes the skill without arguments, present this menu and wait:

> **What would you like to do?**
>
> 1. **init** — Re-check token tracking (optional; the hook is auto-registered)
> 2. **start** — Begin a new tracked session (records start time, clears counters)
> 3. **show** — Display metrics for the current session
> 4. **end** — Stop tracking and show the final report
> 5. **clear** — Archive current session, start a fresh one
> 6. **resume \<name\>** — Continue a previously archived session
> 7. **stats \<session name\>** — Aggregate all archived sessions for a name
> 8. **token-breakdown \[session-name\]** — Analyse where tokens were spent (thinking / replies / tools)
>
> Reply with 1–8 or a keyword.

If invoked with an argument (e.g. `/session-manager start "refactor-auth"`),
skip the menu and go directly to that mode.

---

## Prerequisites

### Hook setup (for token tracking)

Token data is accumulated by the plugin's bundled Stop hook, which is registered
automatically via `hooks/hooks.json` when the plugin is installed and fires on
every Stop event. No manual setup is required; token tracking works out of the box.

Check whether the hook is wired up:

```bash
node -e "
const fs = require('fs')
try {
  const s = JSON.parse(fs.readFileSync('.claude/settings.json', 'utf8'))
  const hooks = s.hooks && s.hooks.Stop
  const wired = Array.isArray(hooks) && hooks.some(h =>
    JSON.stringify(h).includes('record-session-usage')
  )
  console.log(wired ? 'HOOK_ACTIVE' : 'HOOK_MISSING')
} catch { console.log('HOOK_MISSING') }
"
```

If `HOOK_MISSING`, warn the user:

> ⚠ Token tracking hook is not detected. Token tracking is normally registered
> automatically by the plugin. Try reinstalling the plugin or running
> `/reload-plugins`. Time and activity metrics are still recorded.

---

## Mode: `start [label]`

Initialise a new session. Any previous `active.json` is archived first.

`active.json` is written immediately. After printing the confirmation, prompt
the user to `/clear` to start a clean chat. The Stop hook automatically updates
`transcriptPath` to the new transcript file on the first turn after `/clear`.

### Steps

1. **Resolve session name**:

   Ask the user for a name if no label was given:

   > What would you like to name this session?
   > _(e.g. "refactor-auth", "spike-search")_

   Slugify it (lowercase, spaces → hyphens, strip special chars) so it is safe
   as a filename. If a label was provided, slugify that directly.

2. **Archive previous session** (if `active.json` exists and `active: true`):

   ```bash
   node -e "
   const fs = require('fs')
   const f = '.claude/sessions/active.json'
   if (!fs.existsSync(f)) process.exit(0)
   const s = JSON.parse(fs.readFileSync(f, 'utf8'))
   s.active = false
   s.endTime = new Date().toISOString()
   fs.mkdirSync('.claude/sessions', { recursive: true })
   const name = s.sessionName || s.sessionId
   fs.writeFileSync('.claude/sessions/' + name + '-' + s.sessionId + '.json', JSON.stringify(s, null, 2))
   fs.unlinkSync(f)
   console.log('ARCHIVED:' + name + '-' + s.sessionId)
   "
   ```

3. **Capture git context**:

   ```bash
   git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'no-branch'
   git rev-parse --short HEAD 2>/dev/null || echo 'no-commit'
   ```

4. **Write new session state file**:

   ```bash
   node -e "
   const fs = require('fs')
   const id = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
   const label = process.env.SESSION_LABEL || 'unlabelled'
   const sessionName = process.env.SESSION_NAME || id
   const state = {
     sessionId:        id,
     sessionName:      sessionName,
     label:            label,
     active:           true,
     startTime:        new Date().toISOString(),
     endTime:          null,
     lastUpdated:      new Date().toISOString(),
     gitBranch:        process.env.GIT_BRANCH || '',
     gitCommitAtStart: process.env.GIT_COMMIT || '',
     lastTranscriptLine: 0,
     tokens: {
       inputTokens:         0,
       outputTokens:        0,
       cacheReadTokens:     0,
       cacheCreationTokens: 0,
     },
     activity: {
       turns:         0,
       toolCalls:     0,
       filesModified: 0,
       bashCommands:  0,
     },
     estimatedCostUSD: 0,
     cacheSavingsUSD:  0,
   }
   fs.mkdirSync('.claude/sessions', { recursive: true })
   fs.writeFileSync('.claude/sessions/active.json', JSON.stringify(state, null, 2))
   console.log('SESSION_STARTED:' + id + ' NAME:' + sessionName)
   "
   ```

   Pass label, session name, branch, and commit as env vars:

   ```bash
   SESSION_LABEL="<label>" SESSION_NAME="<sessionName>" GIT_BRANCH="<branch>" GIT_COMMIT="<commit>" node -e "..."
   ```

5. **Print start confirmation then prompt `/clear`**:

   ```
   Session started — <label>
   ID: <sessionId>   Branch: <branch>   Commit: <commit>
   Archive name: <sessionName>-<sessionId>.json
   Token tracking: ACTIVE  (or: not configured — run /session-manager init)

   ╔══════════════════════════════════════════════════════════════╗
   ║  💬  TYPE  /clear  TO START WITH A CLEAN CHAT LOG           ║
   ║  Tracking is already live. The transcript path updates       ║
   ║  automatically on the first turn of the new chat.           ║
   ╚══════════════════════════════════════════════════════════════╝
   ```

---

## Mode: `show`

Display metrics for the current active session without ending it.

### Steps

1. **Read state file**:

   ```bash
   node -e "
   const fs = require('fs')
   try {
     const s = JSON.parse(fs.readFileSync('.claude/sessions/active.json', 'utf8'))
     console.log(JSON.stringify(s))
   } catch { console.log('NO_SESSION') }
   "
   ```

   If `NO_SESSION`, tell the user:
   > No active session. Start one with `/session-manager start`.

2. **Calculate elapsed time**:

   ```bash
   node -e "
   const start = new Date(process.env.START_TIME)
   const now   = new Date()
   const ms    = now - start
   const h     = Math.floor(ms / 3600000)
   const m     = Math.floor((ms % 3600000) / 60000)
   const s     = Math.floor((ms % 60000) / 1000)
   console.log(h + 'h ' + m + 'm ' + s + 's')
   "
   ```

2.5. **Scan for in-progress activity** (lines written since last Stop hook fire):

   The Stop hook fires once per complete turn, so `estimatedCostUSD` in `active.json`
   always lags by one turn. This step reads any transcript lines added since the last
   hook fire and computes an additional "in-progress" cost estimate.

   ```bash
   node -e "
   const fs = require('fs')
   const transcriptPath = process.env.TRANSCRIPT_PATH
   const lastLine       = parseInt(process.env.LAST_LINE || '0', 10)
   const pricing        = { input: 3.00, output: 15.00, cacheRead: 0.30, cacheCreation: 3.75 }

   if (!transcriptPath || !fs.existsSync(transcriptPath)) {
     console.log(JSON.stringify({ newLines: 0, liveCost: 0 }))
     process.exit(0)
   }

   const all = fs.readFileSync(transcriptPath, 'utf8').split('\n').filter(Boolean)
   if (all.length <= lastLine) {
     console.log(JSON.stringify({ newLines: 0, liveCost: 0 }))
     process.exit(0)
   }

   const newLines = all.slice(lastLine)
   const seenIds  = new Set()
   let input = 0, output = 0, cacheR = 0, cacheC = 0

   for (const line of newLines) {
     let e
     try { e = JSON.parse(line) } catch { continue }
     const msg =
       e.message ||
       (e.role === 'assistant' ? e : null) ||
       (e.type === 'message' && e.role === 'assistant' ? e : null)
     if (!msg || !msg.usage) continue
     if (msg.id && seenIds.has(msg.id)) continue
     if (msg.id) seenIds.add(msg.id)
     input  += msg.usage.input_tokens                ?? 0
     output += msg.usage.output_tokens               ?? 0
     cacheR += msg.usage.cache_read_input_tokens     ?? 0
     cacheC += msg.usage.cache_creation_input_tokens ?? 0
   }

   const liveCost =
     (input  / 1e6) * pricing.input         +
     (output / 1e6) * pricing.output        +
     (cacheR / 1e6) * pricing.cacheRead     +
     (cacheC / 1e6) * pricing.cacheCreation

   console.log(JSON.stringify({ newLines: newLines.length, liveCost,
     input, output, cacheR, cacheC }))
   "
   ```

   Pass `TRANSCRIPT_PATH = state.transcriptPath` and `LAST_LINE = state.lastTranscriptLine`
   as env vars.

   Store the result as `liveActivity`. If `liveActivity.liveCost > 0`, the current turn
   has uncommitted activity — include it in the Metrics Report display (see Output Format).

3. **Print the Metrics Report** (see Output Format).

---

## Mode: `end`

Stop tracking and show the final session report.

### Steps

1. Read state file (same as `show` — abort with message if `NO_SESSION`).

2. **Finalise session state**:

   ```bash
   node -e "
   const fs = require('fs')
   const s = JSON.parse(fs.readFileSync('.claude/sessions/active.json', 'utf8'))
   s.active  = false
   s.endTime = new Date().toISOString()
   const name = s.sessionName || s.sessionId
   const archivePath = '.claude/sessions/' + name + '-' + s.sessionId + '.json'
   fs.writeFileSync(archivePath, JSON.stringify(s, null, 2))
   fs.unlinkSync('.claude/sessions/active.json')
   console.log(JSON.stringify(s))
   "
   ```

3. Calculate elapsed session time (start → endTime).

4. Print the final Session Metrics Report with `FINAL` heading.

---

## Mode: `clear [label]`

Archive the active session and immediately start a fresh one. If no session is
active, behaves identically to `start`.

`active.json` for the new session is written immediately. After printing the
confirmation, prompt the user to `/clear` to start a clean chat.

### Steps

1. **Resolve the new session name** — same rules as `start`.

2. **Show what will be archived and archive it** (if `active.json` exists):

   Read the current session to show a summary:

   ```bash
   node -e "
   const fs = require('fs')
   const f = '.claude/sessions/active.json'
   if (!fs.existsSync(f)) { console.log('NO_ACTIVE'); process.exit(0) }
   const s = JSON.parse(fs.readFileSync(f, 'utf8'))
   const ms  = Date.now() - new Date(s.startTime).getTime()
   const h   = Math.floor(ms / 3600000)
   const m   = Math.floor((ms % 3600000) / 60000)
   console.log(JSON.stringify({
     label:    s.label,
     duration: h + 'h ' + m + 'm',
     cost:     s.estimatedCostUSD.toFixed(4),
     turns:    s.activity.turns,
   }))
   "
   ```

   Print a preview line (skip if `NO_ACTIVE`):
   ```
   Will archive: <label>  |  Duration: <Xh Ym>  |  Turns: N  |  Cost: $X.XXXX
   ```

   Then archive:

   ```bash
   node -e "
   const fs = require('fs')
   const f = '.claude/sessions/active.json'
   if (!fs.existsSync(f)) { console.log('NO_ACTIVE'); process.exit(0) }
   const s = JSON.parse(fs.readFileSync(f, 'utf8'))
   s.active  = false
   s.endTime = new Date().toISOString()
   const name = s.sessionName || s.sessionId
   const archivePath = '.claude/sessions/' + name + '-' + s.sessionId + '.json'
   fs.writeFileSync(archivePath, JSON.stringify(s, null, 2))
   fs.unlinkSync(f)
   console.log('ARCHIVED:' + archivePath)
   "
   ```

   Print a one-line summary (skip if `NO_ACTIVE`):

   ```
   ✔ Session archived — <label> (<archivePath>)
     Duration: <Xh Ym Zs>  |  Tokens: <N,NNN>  |  Cost: $<X.XXXX>
   ```

3. **Capture git context**:

   ```bash
   git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'no-branch'
   git rev-parse --short HEAD 2>/dev/null || echo 'no-commit'
   ```

4. **Write a fresh session state file** (identical to `start` step 4).

5. **Print confirmation then prompt `/clear`**:

   ```
   ✔ Fresh session started — <label>
   ID: <sessionId>   Branch: <branch>   Commit: <commit>
   Archive name: <sessionName>-<sessionId>.json
   Token tracking: ACTIVE  (or: not configured — run /session-manager init)

   ╔══════════════════════════════════════════════════════════════╗
   ║  💬  TYPE  /clear  TO START WITH A CLEAN CHAT LOG           ║
   ║  Tracking is already live. The transcript path updates       ║
   ║  automatically on the first turn of the new chat.           ║
   ╚══════════════════════════════════════════════════════════════╝
   ```

---

## Mode: `resume [name]`

Continue work under a previously archived session name. A resumed session is a
**new** `active.json` that inherits the label from the original, but its archive
filename appends a run counter: `-2`, `-3`, etc.

Example sequence for session `refactor-auth`:
```
refactor-auth-2026-05-06T08-00-00.json   ← original (run 1)
refactor-auth-2-2026-05-07T09-00-00.json ← first resume
refactor-auth-3-2026-05-08T10-00-00.json ← second resume
```

All three are picked up by `stats refactor-auth` because they all start with `refactor-auth-`.

### Steps

1. **Resolve the session name to resume**:

   - If an argument is provided, use it directly.
   - If no argument, list all distinct session names from archived files and ask
     the user to pick one:

     ```bash
     node -e "
     const fs = require('fs')
     const dir = '.claude/sessions'
     if (!fs.existsSync(dir)) { console.log('NO_SESSIONS'); process.exit(0) }
     const files = fs.readdirSync(dir)
       .filter(f => f.endsWith('.json') && f !== 'active.json' && f !== 'pricing-cache.json')
       .sort()
       .reverse()
     const names = [...new Set(files.map(f => {
       const m = f.match(/^(.+)-(\d{4}-\d{2}-\d{2}T[\d-]{8})\.json$/)
       return m ? m[1] : null
     }).filter(Boolean))]
     console.log(JSON.stringify({ files, names }))
     "
     ```

     Present the names as a numbered list and wait for the user to choose.

2. **Count existing runs** to determine the next run number:

   ```bash
   node -e "
   const fs = require('fs')
   const name = process.env.SESSION_NAME
   const dir = '.claude/sessions'
   const files = fs.existsSync(dir) ? fs.readdirSync(dir) : []
   const pattern = new RegExp('^' + name.replace(/[-]/g, '\\\\-') + '(-\\\\d+)?-\\\\d{4}-\\\\d{2}-\\\\d{2}')
   const count = files.filter(f => pattern.test(f)).length
   const nextRun = count + 1
   console.log('NEXT_RUN:' + nextRun)
   "
   ```

3. **Archive any current active session** (same as `clear` step 2).

4. **Derive the new session name**:

   - Run 1 (original): `<name>` — handled by `start`, not `resume`
   - Run 2+: `<name>-<nextRun>` — e.g. `refactor-auth-2`, `refactor-auth-3`

5. **Write the new session state file**:

   ```bash
   node -e "
   const fs = require('fs')
   const id        = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
   const baseName  = process.env.BASE_NAME
   const nextRun   = parseInt(process.env.NEXT_RUN, 10)
   const runSuffix = nextRun > 1 ? '-' + nextRun : ''
   const sessionName = baseName + runSuffix
   const label       = sessionName + ' (resumed)'
   const state = {
     sessionId:        id,
     sessionName:      sessionName,
     label:            label,
     resumedFrom:      baseName,
     runNumber:        nextRun,
     active:           true,
     startTime:        new Date().toISOString(),
     endTime:          null,
     lastUpdated:      new Date().toISOString(),
     gitBranch:        process.env.GIT_BRANCH || '',
     gitCommitAtStart: process.env.GIT_COMMIT || '',
     lastTranscriptLine: 0,
     tokens: {
       inputTokens:         0,
       outputTokens:        0,
       cacheReadTokens:     0,
       cacheCreationTokens: 0,
     },
     activity: {
       turns:         0,
       toolCalls:     0,
       filesModified: 0,
       bashCommands:  0,
     },
     estimatedCostUSD: 0,
     cacheSavingsUSD:  0,
   }
   fs.mkdirSync('.claude/sessions', { recursive: true })
   fs.writeFileSync('.claude/sessions/active.json', JSON.stringify(state, null, 2))
   console.log('RESUMED:' + sessionName + ' id:' + id)
   "
   ```

   Pass env vars: `BASE_NAME`, `NEXT_RUN`, `GIT_BRANCH`, `GIT_COMMIT`.

6. **Print confirmation**:

   ```
   ✔ Session resumed — <sessionName> (run <nextRun>)
   ID: <sessionId>   Branch: <branch>   Commit: <commit>
   Archive name: <sessionName>-<sessionId>.json
   Token tracking: ACTIVE  (or: not configured — run /session-manager init)
   ```

---

## Mode: `stats <session name>`

Aggregate all archived sessions for a given name into a single combined report.
Reads every `.claude/sessions/<name>-*.json` file, sums all numeric fields, and
shows a per-session breakdown plus totals.

### Steps

1. **List matching session files**:

   ```bash
   node -e "
   const fs = require('fs')
   const name = process.env.SESSION_NAME
   if (!name) { console.log('NO_NAME'); process.exit(0) }
   const dir = '.claude/sessions'
   if (!fs.existsSync(dir)) { console.log('NO_SESSIONS'); process.exit(0) }
   const files = fs.readdirSync(dir)
     .filter(f => f.startsWith(name + '-') && f.endsWith('.json')
               && f !== 'active.json' && f !== 'pricing-cache.json')
     .sort()
   console.log(JSON.stringify(files))
   "
   ```

   If no files found:
   > No archived sessions found for `<name>`. Sessions are stored as
   > `<name>-<timestamp>.json` — make sure `/session-manager start` was
   > called with this name.

2. **Load and aggregate all sessions**:

   ```bash
   node -e "
   const fs = require('fs')
   const name = process.env.SESSION_NAME
   const dir = '.claude/sessions'
   const files = fs.readdirSync(dir)
     .filter(f => f.startsWith(name + '-') && f.endsWith('.json')
               && f !== 'active.json' && f !== 'pricing-cache.json')
     .sort()
   const sessions = files.map(f => JSON.parse(fs.readFileSync(dir + '/' + f, 'utf8')))
   const totals = sessions.reduce((acc, s) => {
     const ms = s.endTime && s.startTime
       ? new Date(s.endTime) - new Date(s.startTime) : 0
     acc.durationMs        += ms
     acc.inputTokens       += s.tokens.inputTokens || 0
     acc.outputTokens      += s.tokens.outputTokens || 0
     acc.cacheReadTokens   += s.tokens.cacheReadTokens || 0
     acc.cacheCreationTokens += s.tokens.cacheCreationTokens || 0
     acc.turns             += s.activity.turns || 0
     acc.toolCalls         += s.activity.toolCalls || 0
     acc.filesModified     += s.activity.filesModified || 0
     acc.bashCommands      += s.activity.bashCommands || 0
     acc.estimatedCostUSD  += s.estimatedCostUSD || 0
     acc.cacheSavingsUSD   += s.cacheSavingsUSD || 0
     return acc
   }, {
     durationMs: 0, inputTokens: 0, outputTokens: 0,
     cacheReadTokens: 0, cacheCreationTokens: 0,
     turns: 0, toolCalls: 0, filesModified: 0, bashCommands: 0,
     estimatedCostUSD: 0, cacheSavingsUSD: 0
   })
   console.log(JSON.stringify({ sessions, totals }))
   "
   ```

3. **Print the Collated Report**:

   ```
   ╔══════════════════════════════════════════════════════════════╗
   ║           📊  COLLATED SESSIONS — <name>                    ║
   ╠══════════════════════════════════════════════════════════════╣
   ║  Sessions found: <N>                                         ║
   ╠══════════════════════════════════════════════════════════════╣
   ║  SESSION BREAKDOWN                                           ║
   ║  #  Label                    Duration  Cost      Tokens      ║
   ║  1  <label (30 chars)>       0h Xm Ys  $X.XXXX   N,NNN       ║
   ║  2  <label>                  …         …          …           ║
   ╠══════════════════════════════════════════════════════════════╣
   ║  TOTALS                                                      ║
   ║  Total Duration    <Xh Ym Zs>                                ║
   ║  Input             <N,NNN>                                   ║
   ║  Output            <N,NNN>                                   ║
   ║  Cache Read        <N,NNN>   (saved ~$<X.XX>)                ║
   ║  Cache Creation    <N,NNN>                                   ║
   ║  All Tokens        <N,NNN>                                   ║
   ║  Turns             <N>                                       ║
   ║  Tool Calls        <N>                                       ║
   ║  Files Modified    <N>                                       ║
   ║  Bash Commands     <N>                                       ║
   ╠══════════════════════════════════════════════════════════════╣
   ║  TOTAL COST   $<X.XXXX>   (claude-sonnet-4-6 rates)         ║
   ╚══════════════════════════════════════════════════════════════╝
   ```

---

## Mode: `init`

Token tracking is wired automatically: the plugin registers its bundled Stop
hook through `hooks/hooks.json` on install. This mode just confirms tracking is
active — there is nothing to set up manually.

### Steps

1. Confirm the plugin hook is loaded:

   > Token tracking is registered automatically by the plugin. Run a turn, then
   > `/session-manager show` to confirm token fields populate.

2. If token fields stay `—`, tell the user the hook is not firing and suggest:

   > Run `/reload-plugins` (or reinstall `session-manager@claude-meter`) so the
   > bundled Stop hook is picked up. Do **not** add a hook to
   > `.claude/settings.json` manually — that would double-count tokens.

---

## Output Format

### Session Metrics Report

```
╔══════════════════════════════════════════════════════════════╗
║                   📊  SESSION METRICS                        ║
╠══════════════════════════════════════════════════════════════╣
║  Label       <label, truncated to 45 chars>                  ║
║  Session ID  <sessionId>                                     ║
║  Branch      <gitBranch>                                     ║
╠══════════════════════════════════════════════════════════════╣
║  Started     <YYYY-MM-DD HH:MM:SS local>                     ║
║  Duration    <Xh Ym Zs>                                      ║
╠══════════════════════════════════════════════════════════════╣
║  TOKENS                                                      ║
║  Input            <N,NNN>                                    ║
║  Output           <N,NNN>                                    ║
║  Cache Read       <N,NNN>   (saved ~$<X.XX>)                 ║
║  Cache Creation   <N,NNN>                                    ║
║  Total            <N,NNN>                                    ║
╠══════════════════════════════════════════════════════════════╣
║  ACTIVITY                                                    ║
║  Turns              <N>                                      ║
║  Tool calls         <N>                                      ║
║  Files modified     <N>                                      ║
║  Bash commands      <N>                                      ║
╠══════════════════════════════════════════════════════════════╣
║  EST. COST   $<X.XXXX>   (claude-sonnet-4-6 rates)          ║
║  IN-PROGRESS $<X.XXXX>   (+<N> lines, current turn)         ║
║  LIVE EST.   $<X.XXXX>   (committed + in-progress)          ║
╚══════════════════════════════════════════════════════════════╝
```

Only show the `IN-PROGRESS` and `LIVE EST.` lines when `liveActivity.liveCost > 0`.
If `liveActivity.newLines > 0` but `liveActivity.liveCost == 0` (no assistant usage found
yet in the new lines), show:
```
║  IN-PROGRESS —           (<N> lines, no usage data yet)     ║
```

**Formatting rules:**
- Numbers with commas: `45,231` not `45231`
- Unknown values: `—`
- Duration: always show at least minutes (`0h 2m 14s`)
- Cost: 4 decimal places, USD
- Cache savings: `—` when cache read tokens = 0

---

## Token Cost Reference

Rates are read at runtime from `.claude/sessions/pricing-cache.json`.
The model is taken from the `CLAUDE_MODEL` environment variable; if unset,
`claude-sonnet-4-6` is used as the default. If the model is not found in
the cache, fall back to the `claude-sonnet-4-6` entry.

Fetch rates with:

```bash
node -e "
const fs = require('fs')
const model = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6'
const fallback = { input: 3, output: 15, cacheRead: 0.3, cacheCreation: 3.75 }
try {
  const cache = JSON.parse(fs.readFileSync('.claude/sessions/pricing-cache.json', 'utf8'))
  const rates = cache.pricing[model] || cache.pricing['claude-sonnet-4-6'] || fallback
  console.log(JSON.stringify({ model, rates }))
} catch {
  console.log(JSON.stringify({ model, rates: fallback }))
}
"
```

Use the returned `rates` object wherever cost or savings are computed:

- `estimatedCostUSD = (inputTokens × rates.input + outputTokens × rates.output + cacheCreationTokens × rates.cacheCreation + cacheReadTokens × rates.cacheRead) / 1_000_000`
- `cacheSavingsUSD  = cacheReadTokens × (rates.input − rates.cacheRead) / 1_000_000`

Display the active rates in all reports:

```
EST. COST   $X.XXXX   (<model> rates — input $X/1M  output $X/1M)
```

These are estimates. Actual billing depends on the model in use and any
Anthropic pricing changes. Do not use these figures for official cost reporting.

---

## State Files

### `.claude/sessions/active.json` — current session

```json
{
  "sessionId":           "2026-05-06T10-00-00",
  "sessionName":         "refactor-auth",
  "label":               "refactor-auth",
  "active":              true,
  "startTime":           "2026-05-06T10:00:00.000Z",
  "endTime":             null,
  "lastUpdated":         "2026-05-06T10:23:45.000Z",
  "gitBranch":           "feature/refactor-auth",
  "gitCommitAtStart":    "abc1234",
  "lastTranscriptLine":  142,
  "tokens": {
    "inputTokens":         45231,
    "outputTokens":         8120,
    "cacheReadTokens":     12000,
    "cacheCreationTokens":  3000
  },
  "activity": {
    "turns":          12,
    "toolCalls":      47,
    "filesModified":   8,
    "bashCommands":   15
  },
  "estimatedCostUSD":  0.2156,
  "cacheSavingsUSD":   0.0324
}
```

Ended sessions are archived to `.claude/sessions/<name>-<sessionId>.json`.

---

## Mode: `token-breakdown [session-name]`

Analyse where tokens were spent in a session, breaking output tokens into
estimated per-category buckets (thinking, text replies, tool calls) and
showing per-turn detail. Works on the active session or any archived one.

If no argument is given, use the active session (`active.json`). If an argument
is given, locate the matching archived file in `.claude/sessions/`.

### Steps

1. **Resolve the session file**:

   ```bash
   node -e "
   const fs = require('fs')
   const name = process.env.SESSION_NAME
   const dir = '.claude/sessions'

   if (!name) {
     const f = dir + '/active.json'
     if (!fs.existsSync(f)) { console.log('NO_SESSION'); process.exit(0) }
     console.log(JSON.stringify(JSON.parse(fs.readFileSync(f, 'utf8'))))
     process.exit(0)
   }

   const files = fs.readdirSync(dir)
     .filter(f => f.startsWith(name + '-') && f.endsWith('.json')
               && f !== 'active.json' && f !== 'pricing-cache.json')
     .sort()
     .reverse()
   if (!files.length) { console.log('NOT_FOUND'); process.exit(0) }
   console.log(JSON.stringify(JSON.parse(fs.readFileSync(dir + '/' + files[0], 'utf8'))))
   "
   ```

   If `NO_SESSION`:
   > No active session. Start one with `/session-manager start` or pass a session name.

   If `NOT_FOUND`:
   > No archived session found matching `<name>`.

2. **Verify transcript path**:

   The session JSON must have a `transcriptPath` field. If missing or file does not exist:

   > ⚠ Transcript path not recorded for this session. Token breakdown requires
   > the transcript JSONL. Make sure the session was run with the Stop hook active
   > and at least one full turn completed.

   Then stop.

3. **Parse the transcript**:

   Use `firstTranscriptLine` and `lastTranscriptLine` from the session JSON as the
   exact line range. Fall back to timestamp filtering only when `firstTranscriptLine`
   is absent (older sessions).

   ```bash
   node -e "
   const fs = require('fs')
   const transcriptPath  = process.env.TRANSCRIPT_PATH
   const sessionStart    = process.env.SESSION_START
   const firstLine       = parseInt(process.env.FIRST_LINE  || '-1', 10)
   const lastLine        = parseInt(process.env.LAST_LINE   || '-1', 10)

   if (!fs.existsSync(transcriptPath)) { console.log('TRANSCRIPT_MISSING'); process.exit(0) }

   const allLines = fs.readFileSync(transcriptPath, 'utf8').split('\n').filter(Boolean)

   let lines
   if (firstLine >= 0 && lastLine >= firstLine) {
     lines = allLines.slice(firstLine, lastLine)
   } else {
     const startMs = new Date(sessionStart).getTime()
     lines = allLines.filter(l => {
       try {
         const e = JSON.parse(l)
         return !e.timestamp || new Date(e.timestamp).getTime() >= startMs
       } catch { return false }
     })
   }

   const seenIds   = new Set()
   const turns     = []

   for (const line of lines) {
     let entry
     try { entry = JSON.parse(line) } catch { continue }

     const msg =
       entry.message ||
       (entry.role === 'assistant' ? entry : null) ||
       (entry.type === 'message' && entry.role === 'assistant' ? entry : null)

     if (!msg || !msg.usage) continue

     const id = msg.id
     if (id && seenIds.has(id)) continue
     if (id) seenIds.add(id)

     const usage   = msg.usage
     const content = Array.isArray(msg.content) ? msg.content : []

     let thinkingChars = 0, textChars = 0, toolChars = 0
     const toolNames = []

     for (const block of content) {
       if (block.type === 'thinking') {
         thinkingChars += (block.thinking || '').length
       } else if (block.type === 'text') {
         textChars += (block.text || '').length
       } else if (block.type === 'tool_use') {
         toolChars += JSON.stringify(block.input || {}).length + (block.name || '').length
         toolNames.push(block.name)
       }
     }

     const totalChars = thinkingChars + textChars + toolChars || 1
     const outTokens  = usage.output_tokens || 0

     turns.push({
       id,
       inputTokens:         usage.input_tokens                ?? 0,
       outputTokens:        outTokens,
       cacheReadTokens:     usage.cache_read_input_tokens     ?? 0,
       cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
       estimated: {
         thinking: Math.round((thinkingChars / totalChars) * outTokens),
         text:     Math.round((textChars     / totalChars) * outTokens),
         tools:    Math.round((toolChars     / totalChars) * outTokens),
       },
       toolNames,
     })
   }

   const totals = turns.reduce((acc, t) => {
     acc.inputTokens         += t.inputTokens
     acc.outputTokens        += t.outputTokens
     acc.cacheReadTokens     += t.cacheReadTokens
     acc.cacheCreationTokens += t.cacheCreationTokens
     acc.thinkingTokens      += t.estimated.thinking
     acc.textTokens          += t.estimated.text
     acc.toolTokens          += t.estimated.tools
     return acc
   }, { inputTokens:0, outputTokens:0, cacheReadTokens:0, cacheCreationTokens:0,
        thinkingTokens:0, textTokens:0, toolTokens:0 })

   const toolFreq = {}
   for (const t of turns) {
     for (const name of t.toolNames) {
       toolFreq[name] = (toolFreq[name] || 0) + 1
     }
   }

   const topTurns = [...turns]
     .sort((a, b) => b.outputTokens - a.outputTokens)
     .slice(0, 5)
     .map((t, i) => ({
       rank:        i + 1,
       outputTokens: t.outputTokens,
       inputTokens:  t.inputTokens,
       cacheRead:    t.cacheReadTokens,
       tools:        t.toolNames,
       estimated:    t.estimated,
     }))

   console.log(JSON.stringify({ totals, toolFreq, topTurns, turnCount: turns.length }))
   "
   ```

   Pass `TRANSCRIPT_PATH`, `SESSION_START`, `FIRST_LINE`, and `LAST_LINE` as env vars.

4. **Build bar charts** — use a helper to render a 20-char ASCII bar:

   ```
   percentage → filled = Math.round(pct / 5), empty = 20 - filled
   bar = '█'.repeat(filled) + '░'.repeat(empty)
   ```

5. **Print the Token Breakdown Report**:

```
╔══════════════════════════════════════════════════════════════════╗
║              🔬  TOKEN BREAKDOWN — <label>                      ║
╠══════════════════════════════════════════════════════════════════╣
║  Session    <sessionId>                                          ║
║  Turns      <N>   (from transcript)                             ║
╠══════════════════════════════════════════════════════════════════╣
║  INPUT TOKENS                                                    ║
║  Fresh input      <N,NNN>                                        ║
║  Cache hits       <N,NNN>   (<X>% of total input)               ║
║  Cache writes     <N,NNN>                                        ║
║  Cache hit rate   <X>%   ████████████████░░░░                   ║
╠══════════════════════════════════════════════════════════════════╣
║  OUTPUT TOKENS: <N,NNN>  (estimated split)                      ║
║                                                                  ║
║  Thinking    <N,NNN>  (<X>%)  ████░░░░░░░░░░░░░░░░░░            ║
║  Text reply  <N,NNN>  (<X>%)  ████████░░░░░░░░░░░░              ║
║  Tool calls  <N,NNN>  (<X>%)  ████████████░░░░░░░░              ║
╠══════════════════════════════════════════════════════════════════╣
║  TOOL CALL BREAKDOWN                                             ║
║  <ToolName>    <N> calls   ~<N,NNN> tokens                      ║
╠══════════════════════════════════════════════════════════════════╣
║  TOP 5 HEAVIEST TURNS (by output tokens)                        ║
║  #1  out: <N,NNN>  in: <N,NNN>  cache: <N,NNN>                  ║
║      tools: <Tool1>, <Tool2>                                    ║
║      split: think <N,NNN> / text <N,NNN> / tools <N,NNN>        ║
╠══════════════════════════════════════════════════════════════════╣
║  ⚠ Output split is estimated from content character lengths.    ║
║    Input and cache figures are exact API values.                ║
╚══════════════════════════════════════════════════════════════════╝
```

**Formatting rules:**
- Numbers with commas: `45,231`
- Percentages: 1 decimal place
- Tool token estimates: distribute the turn's output tokens proportionally
  across tools by their serialised JSON character length
- If a turn has zero tool calls, all output goes to thinking + text buckets only
- If a turn has zero thinking blocks, all non-tool output goes to text

---

## Hard Constraints

| Rule | Reason |
|---|---|
| Never commit `.claude/sessions/` | Local cost data only |
| Never fabricate token counts | If hook not set up, show `—` |
| Cost figures are estimates only | Make this clear in every display |
| Keep hook script non-blocking | Wrap all logic in try/catch |
| Archive before starting new session | Never silently overwrite active.json |
