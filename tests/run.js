/**
 * Test suite for claude-meter / session-manager hook logic.
 *
 * Run with: node tests/run.js
 *
 * Covers:
 *   - Cost calculation math
 *   - Token accumulation from transcript lines
 *   - Message-ID deduplication
 *   - Pricing table lookup (exact match, prefix match, fallback)
 *   - Cache savings calculation
 *   - buildPricingMap from LiteLLM raw format
 *   - firstTranscriptLine / lastTranscriptLine offset filtering
 *   - Transcript-switch detection (path change resets offset)
 *   - extractLogEntries output format
 */

const assert = require('assert')
const {
  MODEL_PRICING,
  DEFAULT_PRICING,
  parseUsageFromLines,
  estimateCost,
  getPricing,
  buildPricingMap,
  extractLogEntries,
} = require('../hooks/record-session-usage')

let passed = 0
let failed = 0

function test(name, fn) {
  try {
    fn()
    console.log(`  ✓  ${name}`)
    passed++
  } catch (err) {
    console.error(`  ✗  ${name}`)
    console.error(`     ${err.message}`)
    failed++
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAssistantLine(id, usage, content = [], timestamp) {
  const entry = {
    type: 'assistant',
    message: { id, role: 'assistant', usage, content },
  }
  if (timestamp) entry.timestamp = timestamp
  return JSON.stringify(entry)
}

function makeUserLine(text, timestamp) {
  const entry = {
    type: 'user',
    timestamp,
    content: [{ type: 'text', text }],
  }
  return JSON.stringify(entry)
}

// ── Cost calculation ──────────────────────────────────────────────────────────

console.log('\nCost calculation')

test('zero tokens → zero cost', () => {
  const { cost } = estimateCost(
    { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
    'claude-sonnet-4-6'
  )
  assert.strictEqual(cost, 0)
})

test('1M input tokens at sonnet-4-6 rate → $3.00', () => {
  const { cost } = estimateCost(
    { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
    'claude-sonnet-4-6'
  )
  assert.strictEqual(cost, 3.00)
})

test('1M output tokens at sonnet-4-6 rate → $15.00', () => {
  const { cost } = estimateCost(
    { inputTokens: 0, outputTokens: 1_000_000, cacheReadTokens: 0, cacheCreationTokens: 0 },
    'claude-sonnet-4-6'
  )
  assert.strictEqual(cost, 15.00)
})

test('1M cache read tokens at sonnet-4-6 → saves $2.70', () => {
  const { cacheSavings } = estimateCost(
    { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000, cacheCreationTokens: 0 },
    'claude-sonnet-4-6'
  )
  assert.strictEqual(cacheSavings, 2.70)
})

test('haiku-4-5 pricing applied correctly', () => {
  const { cost } = estimateCost(
    { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
    'claude-haiku-4-5'
  )
  assert.strictEqual(cost, 1.00)
})

test('mixed token types accumulate correctly', () => {
  const { cost } = estimateCost(
    { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 0, cacheCreationTokens: 0 },
    'claude-sonnet-4-6'
  )
  assert.strictEqual(cost, 18.00)
})

// ── Pricing table lookup ──────────────────────────────────────────────────────

console.log('\nPricing table lookup')

test('exact model match', () => {
  const p = getPricing('claude-sonnet-4-6')
  assert.strictEqual(p.input, 3.00)
})

test('prefix match — date-suffixed variant', () => {
  const p = getPricing('claude-sonnet-4-6-20251022')
  assert.strictEqual(p.input, 3.00)
})

test('unknown model falls back to default (sonnet-4-6 rates)', () => {
  const p = getPricing('claude-unknown-model-99')
  assert.deepStrictEqual(p, DEFAULT_PRICING)
})

test('null model falls back to default', () => {
  const p = getPricing(null)
  assert.deepStrictEqual(p, DEFAULT_PRICING)
})

test('dynamic pricing takes precedence over fallback table', () => {
  const dynamic = { 'claude-sonnet-4-6': { input: 999, output: 999, cacheRead: 0, cacheCreation: 0 } }
  const p = getPricing('claude-sonnet-4-6', dynamic)
  assert.strictEqual(p.input, 999)
})

test('longest prefix wins when multiple keys match', () => {
  const dynamic = {
    'claude-sonnet':     { input: 1, output: 1, cacheRead: 0, cacheCreation: 0 },
    'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3, cacheCreation: 3.75 },
  }
  const p = getPricing('claude-sonnet-4-6-20251022', dynamic)
  assert.strictEqual(p.input, 3)
})

// ── buildPricingMap from LiteLLM raw JSON ─────────────────────────────────────

console.log('\nbuildPricingMap')

test('converts per-token costs to per-million correctly', () => {
  const raw = {
    'claude-sonnet-4-6': {
      input_cost_per_token: 0.000003,
      output_cost_per_token: 0.000015,
      cache_read_input_token_cost: 0.0000003,
      cache_creation_input_token_cost: 0.00000375,
    },
  }
  const map = buildPricingMap(raw)
  assert.ok(map['claude-sonnet-4-6'])
  assert.strictEqual(map['claude-sonnet-4-6'].input, 3)
  assert.strictEqual(map['claude-sonnet-4-6'].output, 15)
})

test('filters out non-claude models', () => {
  const raw = {
    'gpt-4o':            { input_cost_per_token: 0.000005, output_cost_per_token: 0.000015 },
    'claude-sonnet-4-6': { input_cost_per_token: 0.000003, output_cost_per_token: 0.000015 },
  }
  const map = buildPricingMap(raw)
  assert.ok(map['claude-sonnet-4-6'])
  assert.ok(!map['gpt-4o'])
})

test('skips models missing both input and output cost', () => {
  const raw = {
    'claude-incomplete': { cache_read_input_token_cost: 0.0000003 },
  }
  const map = buildPricingMap(raw)
  assert.ok(!map['claude-incomplete'])
})

test('defaults missing cache costs to 0', () => {
  const raw = {
    'claude-no-cache': {
      input_cost_per_token: 0.000003,
      output_cost_per_token: 0.000015,
    },
  }
  const map = buildPricingMap(raw)
  assert.strictEqual(map['claude-no-cache'].cacheRead, 0)
  assert.strictEqual(map['claude-no-cache'].cacheCreation, 0)
})

// ── Transcript parsing ────────────────────────────────────────────────────────

console.log('\nTranscript parsing')

test('parses input and output tokens', () => {
  const lines = [makeAssistantLine('msg_1', { input_tokens: 100, output_tokens: 50 })]
  const r = parseUsageFromLines(lines)
  assert.strictEqual(r.inputTokens, 100)
  assert.strictEqual(r.outputTokens, 50)
})

test('parses cache tokens', () => {
  const lines = [makeAssistantLine('msg_1', {
    input_tokens: 0, output_tokens: 0,
    cache_read_input_tokens: 200,
    cache_creation_input_tokens: 50,
  })]
  const r = parseUsageFromLines(lines)
  assert.strictEqual(r.cacheReadTokens, 200)
  assert.strictEqual(r.cacheCreationTokens, 50)
})

test('deduplicates entries with the same message ID', () => {
  const line = makeAssistantLine('msg_dup', { input_tokens: 100, output_tokens: 50 })
  const r = parseUsageFromLines([line, line, line])
  assert.strictEqual(r.inputTokens, 100)
  assert.strictEqual(r.turns, 1)
})

test('accumulates across multiple distinct messages', () => {
  const lines = [
    makeAssistantLine('msg_1', { input_tokens: 100, output_tokens: 50 }),
    makeAssistantLine('msg_2', { input_tokens: 200, output_tokens: 80 }),
  ]
  const r = parseUsageFromLines(lines)
  assert.strictEqual(r.inputTokens, 300)
  assert.strictEqual(r.outputTokens, 130)
  assert.strictEqual(r.turns, 2)
})

test('counts tool_use blocks', () => {
  const lines = [makeAssistantLine('msg_1', { input_tokens: 10, output_tokens: 5 }, [
    { type: 'tool_use', name: 'Bash' },
    { type: 'tool_use', name: 'Read' },
  ])]
  const r = parseUsageFromLines(lines)
  assert.strictEqual(r.toolCalls, 2)
  assert.strictEqual(r.bashCommands, 1)
  assert.strictEqual(r.filesModified, 0)
})

test('counts Edit/Write/NotebookEdit as filesModified', () => {
  const lines = [makeAssistantLine('msg_1', { input_tokens: 10, output_tokens: 5 }, [
    { type: 'tool_use', name: 'Edit' },
    { type: 'tool_use', name: 'Write' },
    { type: 'tool_use', name: 'NotebookEdit' },
  ])]
  const r = parseUsageFromLines(lines)
  assert.strictEqual(r.filesModified, 3)
})

test('skips unparseable lines silently', () => {
  const lines = ['not json', '{broken', makeAssistantLine('msg_1', { input_tokens: 10, output_tokens: 5 })]
  const r = parseUsageFromLines(lines)
  assert.strictEqual(r.inputTokens, 10)
})

test('format B — role:assistant without wrapper', () => {
  const line = JSON.stringify({
    role: 'assistant', id: 'msg_b',
    usage: { input_tokens: 77, output_tokens: 33 },
    content: [],
  })
  const r = parseUsageFromLines([line])
  assert.strictEqual(r.inputTokens, 77)
})

test('format C — type:message role:assistant', () => {
  const line = JSON.stringify({
    type: 'message', role: 'assistant', id: 'msg_c',
    usage: { input_tokens: 55, output_tokens: 22 },
    content: [],
  })
  const r = parseUsageFromLines([line])
  assert.strictEqual(r.inputTokens, 55)
})

// ── Transcript offset filtering ───────────────────────────────────────────────

console.log('\nTranscript offset filtering')

test('reads only lines at or after the given offset', () => {
  // Simulate 5 transcript lines; we pass fromLine=3, so only lines [3,4] should be read.
  // parseUsageFromLines receives the sliced array — we verify by passing only the slice.
  const allLines = [
    makeAssistantLine('msg_old_1', { input_tokens: 999, output_tokens: 999 }),
    makeAssistantLine('msg_old_2', { input_tokens: 999, output_tokens: 999 }),
    makeAssistantLine('msg_old_3', { input_tokens: 999, output_tokens: 999 }),
    makeAssistantLine('msg_new_1', { input_tokens: 10,  output_tokens: 5   }),
    makeAssistantLine('msg_new_2', { input_tokens: 20,  output_tokens: 8   }),
  ]
  const fromLine = 3
  const newLines = allLines.slice(fromLine)
  const r = parseUsageFromLines(newLines)
  assert.strictEqual(r.inputTokens, 30)
  assert.strictEqual(r.outputTokens, 13)
  assert.strictEqual(r.turns, 2)
})

test('empty slice (offset = total length) produces zero counts', () => {
  const allLines = [
    makeAssistantLine('msg_1', { input_tokens: 100, output_tokens: 50 }),
  ]
  const newLines = allLines.slice(allLines.length)
  const r = parseUsageFromLines(newLines)
  assert.strictEqual(r.inputTokens, 0)
  assert.strictEqual(r.turns, 0)
})

test('full slice (offset = 0) reads all lines', () => {
  const allLines = [
    makeAssistantLine('msg_1', { input_tokens: 100, output_tokens: 50 }),
    makeAssistantLine('msg_2', { input_tokens: 200, output_tokens: 80 }),
  ]
  const r = parseUsageFromLines(allLines.slice(0))
  assert.strictEqual(r.inputTokens, 300)
})

// ── Transcript-switch detection ───────────────────────────────────────────────

console.log('\nTranscript-switch detection')

test('different transcript path triggers offset reset to 0', () => {
  // Simulates the state update logic in main() when transcriptPath changes
  const state = {
    lastTranscriptPath: '/old/transcript.jsonl',
    lastTranscriptLine: 42,
    firstTranscriptLine: 5,
  }
  const newTranscriptPath = '/new/transcript.jsonl'

  if (newTranscriptPath && state.lastTranscriptPath && newTranscriptPath !== state.lastTranscriptPath) {
    state.lastTranscriptLine = 0
    delete state.firstTranscriptLine
  }

  assert.strictEqual(state.lastTranscriptLine, 0)
  assert.ok(!('firstTranscriptLine' in state))
})

test('same transcript path does NOT reset offset', () => {
  const path = '/same/transcript.jsonl'
  const state = {
    lastTranscriptPath: path,
    lastTranscriptLine: 42,
    firstTranscriptLine: 5,
  }

  if (path && state.lastTranscriptPath && path !== state.lastTranscriptPath) {
    state.lastTranscriptLine = 0
    delete state.firstTranscriptLine
  }

  assert.strictEqual(state.lastTranscriptLine, 42)
  assert.strictEqual(state.firstTranscriptLine, 5)
})

// ── extractLogEntries ─────────────────────────────────────────────────────────

console.log('\nextractLogEntries')

test('extracts REPLY line from assistant text block', () => {
  const ts = '2026-07-01T10:00:00.000Z'
  const line = JSON.stringify({
    type: 'assistant',
    timestamp: ts,
    message: {
      role: 'assistant',
      usage: { input_tokens: 5, output_tokens: 10 },
      content: [{ type: 'text', text: 'Hello world' }],
    },
  })
  const entries = extractLogEntries([line])
  assert.ok(entries.some(e => e.includes('REPLY') && e.includes('Hello world')))
})

test('extracts TOOL line from tool_use block', () => {
  const ts = '2026-07-01T10:00:00.000Z'
  const line = JSON.stringify({
    type: 'assistant',
    timestamp: ts,
    message: {
      role: 'assistant',
      usage: { input_tokens: 5, output_tokens: 10 },
      content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls -la' } }],
    },
  })
  const entries = extractLogEntries([line])
  assert.ok(entries.some(e => e.includes('TOOL') && e.includes('Bash')))
})

test('extracts USER line from user message', () => {
  const ts = '2026-07-01T10:00:00.000Z'
  const line = JSON.stringify({
    type: 'user',
    timestamp: ts,
    content: [{ type: 'text', text: 'What is 2+2?' }],
  })
  const entries = extractLogEntries([line])
  assert.ok(entries.some(e => e.includes('USER') && e.includes('What is 2+2?')))
})

test('returns empty array for non-message lines', () => {
  const entries = extractLogEntries(['not json', '{}', JSON.stringify({ type: 'system' })])
  assert.strictEqual(entries.length, 0)
})

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
