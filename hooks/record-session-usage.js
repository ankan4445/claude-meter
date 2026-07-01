/**
 * Claude Code Stop hook — accumulates per-turn token usage into the active
 * session state file (.claude/sessions/active.json).
 *
 * The Stop hook fires once per turn (when Claude finishes responding).
 * Its stdin contains a JSON event with a `transcript_path` pointing to the
 * session's JSONL transcript. Each assistant entry in that file carries a
 * `usage` object from the Anthropic Messages API.
 *
 * This script:
 *   1. Reads the event from stdin.
 *   2. Reads the transcript JSONL from `transcript_path`.
 *   3. Processes only lines after the last-processed offset (stored in state).
 *   4. Sums input/output/cache tokens from assistant message entries.
 *   5. Counts tool calls and file-modifying operations.
 *   6. Updates .claude/sessions/active.json with the new cumulative totals.
 *
 * Pricing is loaded dynamically from the LiteLLM model pricing JSON
 * (https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json)
 * and cached locally for 24 hours. The hardcoded MODEL_PRICING table is used
 * as a fallback when the fetch fails or the model is not found in the cache.
 */

const fs = require('fs')
const path = require('path')
const https = require('https')

// Resolve project root: prefer CLAUDE_PROJECT_DIR (set by Claude Code when running
// as an installed plugin) so session files land in the host project, not the plugin dir.
const PROJECT_ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd()

const SESSION_FILE = path.join(PROJECT_ROOT, '.claude', 'sessions', 'active.json')
const PRICING_CACHE_FILE = path.join(PROJECT_ROOT, '.claude', 'sessions', 'pricing-cache.json')
const LOG_DIR = path.join(PROJECT_ROOT, '.claude', 'sessions', 'logs')
const PRICING_SOURCE = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000  // 24 hours
const FETCH_TIMEOUT_MS = 5000

// Fallback per-1M-token pricing — sourced from LiteLLM 2026-05-11
const MODEL_PRICING = {
  'claude-opus-4-7':          { input:  5.00, output:  25.00, cacheRead:  0.50, cacheCreation:  6.25 },
  'claude-opus-4-6':          { input:  5.00, output:  25.00, cacheRead:  0.50, cacheCreation:  6.25 },
  'claude-opus-4-5':          { input:  5.00, output:  25.00, cacheRead:  0.50, cacheCreation:  6.25 },
  'claude-opus-4-1':          { input: 15.00, output:  75.00, cacheRead:  1.50, cacheCreation: 18.75 },
  'claude-4-opus':            { input: 15.00, output:  75.00, cacheRead:  1.50, cacheCreation: 18.75 },
  'claude-3-opus':            { input: 15.00, output:  75.00, cacheRead:  1.50, cacheCreation: 18.75 },
  'claude-sonnet-4-6':        { input:  3.00, output:  15.00, cacheRead:  0.30, cacheCreation:  3.75 },
  'claude-sonnet-4-5':        { input:  3.00, output:  15.00, cacheRead:  0.30, cacheCreation:  3.75 },
  'claude-4-sonnet':          { input:  3.00, output:  15.00, cacheRead:  0.30, cacheCreation:  3.75 },
  'claude-3-7-sonnet':        { input:  3.00, output:  15.00, cacheRead:  0.30, cacheCreation:  3.75 },
  'claude-3-5-sonnet':        { input:  3.00, output:  15.00, cacheRead:  0.30, cacheCreation:  3.75 },
  'claude-haiku-4-5':         { input:  1.00, output:   5.00, cacheRead:  0.10, cacheCreation:  1.25 },
  'claude-3-5-haiku':         { input:  0.80, output:   4.00, cacheRead:  0.08, cacheCreation:  1.00 },
  'claude-3-haiku':           { input:  0.25, output:   1.25, cacheRead:  0.03, cacheCreation:  0.30 },
}
const DEFAULT_PRICING = MODEL_PRICING['claude-sonnet-4-6']

async function readStdin() {
  return new Promise((resolve) => {
    let data = ''
    process.stdin.on('data', (chunk) => (data += chunk))
    process.stdin.on('end', () => resolve(data))
    // If stdin is a TTY (manual test), resolve immediately with empty string
    if (process.stdin.isTTY) resolve('')
  })
}

async function readTranscriptLines(transcriptPath, fromLine) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return { lines: [], count: 0 }

  const all = fs.readFileSync(transcriptPath, 'utf8').split('\n').filter(Boolean)
  const newLines = all.slice(fromLine)
  return { lines: newLines, count: all.length }
}

function parseUsageFromLines(lines, sessionStartTime) {
  const result = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    toolCalls: 0,
    filesModified: 0,
    bashCommands: 0,
    turns: 0,
    model: null,
  }

  const startMs = sessionStartTime ? new Date(sessionStartTime).getTime() : 0

  // A single API call produces one JSONL entry per content block, each carrying
  // the same usage object. Deduplicate by msg.id so tokens are counted once per call.
  const seenMessageIds = new Set()

  for (const line of lines) {
    let entry
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }

    // Skip entries that predate the current session (guards against re-reading
    // old transcript lines when lastTranscriptLine resets to 0 on session start)
    if (startMs > 0 && entry.timestamp) {
      if (new Date(entry.timestamp).getTime() < startMs) continue
    }

    // Handle both raw API response format and transcript wrapper format
    // Format A: { type: 'assistant', message: { usage: {...}, content: [...] } }
    // Format B: { role: 'assistant', usage: {...}, content: [...] }
    // Format C: { type: 'message', role: 'assistant', usage: {...} }
    const msg =
      entry.message ||            // Format A wrapper
      (entry.role === 'assistant' ? entry : null) ||  // Format B
      (entry.type === 'message' && entry.role === 'assistant' ? entry : null) // Format C

    if (!msg) continue

    // Capture model from the most recent assistant entry
    if (entry.model) result.model = entry.model

    const messageId = msg.id  // shared across all content-block entries for one API call
    const isNewMessage = messageId ? !seenMessageIds.has(messageId) : true
    if (messageId) seenMessageIds.add(messageId)

    // Accumulate token counts only once per API call
    if (isNewMessage) {
      const usage = msg.usage
      if (usage) {
        result.inputTokens         += usage.input_tokens                ?? 0
        result.outputTokens        += usage.output_tokens               ?? 0
        result.cacheReadTokens     += usage.cache_read_input_tokens     ?? 0
        result.cacheCreationTokens += usage.cache_creation_input_tokens ?? 0
        result.turns               += 1
      }
    }

    // Count tool uses from content blocks — each block appears in exactly one entry
    const content = Array.isArray(msg.content) ? msg.content : []
    for (const block of content) {
      if (block.type === 'tool_use') {
        result.toolCalls += 1
        if (block.name === 'Edit' || block.name === 'Write' || block.name === 'NotebookEdit') {
          result.filesModified += 1
        }
        if (block.name === 'Bash') {
          result.bashCommands += 1
        }
      }
    }
  }

  return result
}

// Fetch the LiteLLM pricing JSON with a hard timeout; resolve null on any error
function fetchPricingSource() {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), FETCH_TIMEOUT_MS)
    let body = ''
    const req = https.get(PRICING_SOURCE, (res) => {
      res.on('data', (chunk) => (body += chunk))
      res.on('end', () => {
        clearTimeout(timer)
        try {
          resolve(JSON.parse(body))
        } catch {
          resolve(null)
        }
      })
    })
    req.on('error', () => { clearTimeout(timer); resolve(null) })
  })
}

// Convert a per-token cost to per-million-token cost
const perM = (v) => (typeof v === 'number' ? parseFloat((v * 1_000_000).toFixed(6)) : null)

// Build a normalised pricing map from the raw LiteLLM JSON (only claude- models)
function buildPricingMap(raw) {
  const map = {}
  for (const [key, val] of Object.entries(raw)) {
    if (!key.startsWith('claude-')) continue
    const input         = perM(val.input_cost_per_token)
    const output        = perM(val.output_cost_per_token)
    const cacheRead     = perM(val.cache_read_input_token_cost)
    const cacheCreation = perM(val.cache_creation_input_token_cost)
    if (input == null || output == null) continue
    map[key] = { input, output, cacheRead: cacheRead ?? 0, cacheCreation: cacheCreation ?? 0 }
  }
  return map
}

// Load pricing: use local cache if fresh, otherwise fetch and refresh the cache
async function loadPricing() {
  try {
    if (fs.existsSync(PRICING_CACHE_FILE)) {
      const cached = JSON.parse(fs.readFileSync(PRICING_CACHE_FILE, 'utf8'))
      if (Date.now() - cached.fetchedAt < CACHE_TTL_MS && cached.pricing) {
        return cached.pricing
      }
    }
  } catch {
    // Cache unreadable — fall through to fetch
  }

  const raw = await fetchPricingSource()
  if (!raw) return null

  const pricing = buildPricingMap(raw)
  try {
    fs.writeFileSync(PRICING_CACHE_FILE, JSON.stringify({ fetchedAt: Date.now(), pricing }, null, 2))
  } catch {
    // Cache write failure is non-fatal
  }
  return pricing
}

function getPricing(model, dynamicPricing) {
  const sources = [dynamicPricing, MODEL_PRICING].filter(Boolean)
  if (!model) return DEFAULT_PRICING

  for (const source of sources) {
    // Exact match first
    if (source[model]) return source[model]
    // Longest prefix match (handles date-suffixed variants)
    const key = Object.keys(source)
      .filter(k => model.startsWith(k))
      .sort((a, b) => b.length - a.length)[0]
    if (key) return source[key]
  }
  return DEFAULT_PRICING
}

// ── Session log helpers ────────────────────────────────────────────────────

function truncate(str, max = 200) {
  if (typeof str !== 'string') return ''
  const s = str.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim()
  return s.length > max ? s.slice(0, max) + '…' : s
}

function formatToolDetail(block) {
  const inp = block.input || {}
  switch (block.name) {
    case 'Bash':      return inp.command    ? truncate(inp.command, 150)    : ''
    case 'Read':      return inp.file_path  ? inp.file_path                 : ''
    case 'Edit':      return inp.file_path  ? inp.file_path                 : ''
    case 'Write':     return inp.file_path  ? inp.file_path                 : ''
    case 'Glob':      return inp.pattern    ? inp.pattern                   : ''
    case 'Grep':      return inp.pattern    ? `"${inp.pattern}"${inp.path ? ' in ' + inp.path : ''}` : ''
    case 'Agent':     return inp.description ? truncate(inp.description, 120) : ''
    case 'WebFetch':  return inp.url        ? inp.url                       : ''
    case 'WebSearch': return inp.query      ? inp.query                     : ''
    case 'TodoWrite': return 'update task list'
    default:          return inp.description ? truncate(inp.description, 120) : ''
  }
}

// Returns log lines (strings) extracted from new transcript entries
function extractLogEntries(lines) {
  const entries = []

  for (const line of lines) {
    let entry
    try { entry = JSON.parse(line) } catch { continue }

    const ts = entry.timestamp || new Date().toISOString()
    const time = ts.replace('T', ' ').replace(/\.\d+Z$/, ' UTC')

    // User messages
    if (entry.type === 'user') {
      const content = Array.isArray(entry.message?.content)
        ? entry.message.content
        : (Array.isArray(entry.content) ? entry.content : [])

      for (const block of content) {
        if (block.type === 'text' && block.text) {
          entries.push(`${time}  USER    ${truncate(block.text)}`)
        } else if (block.type === 'tool_result') {
          const resultText = Array.isArray(block.content)
            ? block.content.filter(b => b.type === 'text').map(b => b.text).join(' ')
            : (typeof block.content === 'string' ? block.content : '')
          if (resultText) {
            entries.push(`${time}  RESULT  ${truncate(resultText)}`)
          }
        }
      }
      continue
    }

    // Assistant messages
    const msg = entry.message || (entry.role === 'assistant' ? entry : null)
    if (!msg) continue

    const content = Array.isArray(msg.content) ? msg.content : []
    for (const block of content) {
      if (block.type === 'thinking' && block.thinking) {
        entries.push(`${time}  THINK   ${truncate(block.thinking)}`)
      } else if (block.type === 'text' && block.text) {
        entries.push(`${time}  REPLY   ${truncate(block.text)}`)
      } else if (block.type === 'tool_use') {
        const detail = formatToolDetail(block)
        const suffix = detail ? `: ${detail}` : ''
        entries.push(`${time}  TOOL    ${block.name}${suffix}`)
      }
    }
  }

  return entries
}

function getLogFilePath(state) {
  const name = state.ticketId || state.sessionName || state.sessionId
  return path.join(LOG_DIR, `${name}-${state.sessionId}.log`)
}

function writeSessionLog(state, entries) {
  if (!entries.length) return
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true })
    const logPath = getLogFilePath(state)
    const isNew = !fs.existsSync(logPath)
    let output = ''
    if (isNew) {
      output += '=' .repeat(80) + '\n'
      output += `SESSION  : ${state.label || state.sessionId}\n`
      output += `ID       : ${state.sessionId}\n`
      output += `Branch   : ${state.gitBranch || '—'}\n`
      output += `Started  : ${state.startTime}\n`
      output += '='.repeat(80) + '\n'
      output += 'Timestamp (UTC)       Level   Description\n'
      output += '-'.repeat(80) + '\n'
    }
    output += entries.join('\n') + '\n'
    fs.appendFileSync(logPath, output)
  } catch {
    // Never crash Claude Code
  }
}

// ── End session log helpers ────────────────────────────────────────────────

function estimateCost(tokens, model, dynamicPricing) {
  const PRICING = getPricing(model, dynamicPricing)
  const cost =
    (tokens.inputTokens         / 1_000_000) * PRICING.input +
    (tokens.outputTokens        / 1_000_000) * PRICING.output +
    (tokens.cacheReadTokens     / 1_000_000) * (PRICING.cacheRead ?? 0) +
    (tokens.cacheCreationTokens / 1_000_000) * (PRICING.cacheCreation ?? 0)

  const cacheSavings = (tokens.cacheReadTokens / 1_000_000) * (PRICING.input - (PRICING.cacheRead ?? 0))
  return { cost, cacheSavings }
}

async function main() {
  // 1. Read hook event from stdin
  const raw = await readStdin()
  let event = {}
  try {
    if (raw.trim()) event = JSON.parse(raw)
  } catch {
    // Silently ignore parse errors — don't block Claude
  }

  // 2. Load active session state (if any)
  const sessionsDir = path.join(PROJECT_ROOT, '.claude', 'sessions')
  if (!fs.existsSync(sessionsDir)) return  // No active session — nothing to do

  if (!fs.existsSync(SESSION_FILE)) return

  let state
  try {
    state = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'))
  } catch {
    return
  }

  if (!state.active) return  // Session already ended

  // 3. Load dynamic pricing (cache-first, 24h TTL)
  const dynamicPricing = await loadPricing()

  // 4. Read new transcript lines since last processed offset
  const transcriptPath = event.transcript_path || ''

  // When Claude Code starts a new conversation within the same session it creates a new
  // transcript file. If the transcript path changed since the last hook fire, reset the
  // line offset so the first-fire scan runs again on the new file — otherwise
  // lastTranscriptLine (from the old file) would be used as an offset into the new file,
  // corrupting the count and potentially causing token double-counting on the next fire.
  if (transcriptPath && state.lastTranscriptPath && transcriptPath !== state.lastTranscriptPath) {
    state.lastTranscriptLine = 0
    delete state.firstTranscriptLine
  }

  let fromLine = state.lastTranscriptLine || 0

  // On first fire for this session (or after a transcript switch), scan forward to the
  // first entry at or after startTime so we never process pre-session lines — even those
  // lacking a timestamp. Save the offset as firstTranscriptLine so token-breakdown can
  // use it directly.
  if (fromLine === 0 && transcriptPath && fs.existsSync(transcriptPath)) {
    const allLines = fs.readFileSync(transcriptPath, 'utf8').split('\n').filter(Boolean)
    const startMs  = new Date(state.startTime).getTime()
    let firstLine  = allLines.length  // default: nothing new yet
    for (let i = 0; i < allLines.length; i++) {
      try {
        const e = JSON.parse(allLines[i])
        if (e.timestamp && new Date(e.timestamp).getTime() >= startMs) {
          firstLine = i
          break
        }
      } catch { /* skip unparseable lines */ }
    }
    fromLine = firstLine
    state.firstTranscriptLine = firstLine
  }

  const { lines, count: newLineCount } = await readTranscriptLines(transcriptPath, fromLine)

  // 5. Parse usage from the new lines (timestamp guard is now a safety net only)
  const delta = parseUsageFromLines(lines, state.startTime)

  // 6. Accumulate into state
  state.tokens.inputTokens         += delta.inputTokens
  state.tokens.outputTokens        += delta.outputTokens
  state.tokens.cacheReadTokens     += delta.cacheReadTokens
  state.tokens.cacheCreationTokens += delta.cacheCreationTokens
  state.activity.turns             += delta.turns
  state.activity.toolCalls         += delta.toolCalls
  state.activity.filesModified     += delta.filesModified
  state.activity.bashCommands      += delta.bashCommands
  state.lastTranscriptLine          = newLineCount
  state.lastTranscriptPath          = transcriptPath  // track which transcript lastTranscriptLine belongs to
  if (delta.model) state.model      = delta.model
  // Update transcriptPath to the current transcript so token-breakdown uses the latest file
  if (transcriptPath) state.transcriptPath = transcriptPath
  state.sessionLogPath              = getLogFilePath(state)

  // 7. Recalculate cost estimate
  // Use the model from transcript, or fall back to CLAUDE_MODEL env var, or use default
  const modelForPricing = state.model || process.env.CLAUDE_MODEL
  const { cost, cacheSavings } = estimateCost(state.tokens, modelForPricing, dynamicPricing)
  state.estimatedCostUSD   = parseFloat(cost.toFixed(4))
  state.cacheSavingsUSD    = parseFloat(cacheSavings.toFixed(4))
  state.lastUpdated        = new Date().toISOString()

  // 8. Write updated state
  try {
    fs.writeFileSync(SESSION_FILE, JSON.stringify(state, null, 2))
  } catch {
    // Never crash Claude Code
  }

  // 9. Append human-readable log entries for this turn
  const logEntries = extractLogEntries(lines)
  writeSessionLog(state, logEntries)
}

main().catch(() => {})

// Export pure functions for testing
if (typeof module !== 'undefined') {
  module.exports = {
    MODEL_PRICING,
    DEFAULT_PRICING,
    parseUsageFromLines,
    estimateCost,
    getPricing,
    buildPricingMap,
    extractLogEntries,
  }
}
