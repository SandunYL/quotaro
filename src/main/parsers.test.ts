// Run with `npm test` (Node's built-in runner; Node strips the types).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseClaudeStatus, parseCodexLine, dedupe, limitsToStatus, autoStartAt } from './usage.ts'
import { claudeMeta, codexMeta, messagesOf, applyEvent } from './sessions.ts'
import type { Run } from '../shared/types.ts'

const NOW = 1_800_000_000_000

test('Claude status line: both windows, expired one shows as reset', () => {
  const u = parseClaudeStatus({ rate_limits: { five_hour: { used_percentage: 3, resets_at: NOW / 1000 - 10 }, seven_day: { used_percentage: 36, resets_at: NOW / 1000 + 3600 } } }, NOW, NOW)
  assert.deepEqual(u, { five: { percent: 0, resetsAt: null }, week: { percent: 36, resetsAt: NOW + 3600_000 }, asOf: NOW })
  assert.equal(parseClaudeStatus({ session_id: 'x' }, NOW, NOW), undefined)
})

test('Codex rate_limits line: windows by length, resets_in_seconds from the line time', () => {
  const line = JSON.stringify({
    timestamp: new Date(NOW).toISOString(),
    payload: { type: 'token_count', rate_limits: { primary: { used_percent: 12.5, window_minutes: 300, resets_in_seconds: 60 }, secondary: { used_percent: 40, window_minutes: 10080, resets_at: NOW / 1000 + 100 } } },
  })
  assert.deepEqual(parseCodexLine(line, 0, NOW), { asOf: NOW, five: { percent: 12.5, resetsAt: NOW + 60_000 }, week: { percent: 40, resetsAt: NOW + 100_000 } })
  // Judged later, the 5-hour window has reset.
  assert.deepEqual(parseCodexLine(line, 0, NOW + 61_000)?.five, { percent: 0, resetsAt: null })
  assert.equal(parseCodexLine('not json', 0, NOW), undefined)
})

test('dedupe keeps only changes per account and window', () => {
  const s = [{ t: 1, a: 'x', k: '5h' as const, p: 1 }, { t: 2, a: 'x', k: '5h' as const, p: 1 }, { t: 3, a: 'x', k: 'week' as const, p: 1 }, { t: 4, a: 'x', k: '5h' as const, p: 2 }]
  assert.deepEqual(dedupe(s).map(x => x.t), [1, 3, 4])
})

test('Claude transcript: custom title wins, wrapper prompts are skipped', () => {
  const text = [
    JSON.stringify({ type: 'user', cwd: '/w', message: { content: '<command-name>/clear</command-name>' } }),
    JSON.stringify({ type: 'user', cwd: '/w', message: { content: [{ type: 'text', text: 'Fix the login bug' }] } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Done.' }, { type: 'tool_use' }] } }),
    JSON.stringify({ type: 'custom-title', customTitle: 'Login fix' }),
  ].join('\n')
  assert.deepEqual(claudeMeta(text), { title: 'Login fix', cwd: '/w' })
  assert.deepEqual(messagesOf('claude', text), [{ role: 'user', text: 'Fix the login bug' }, { role: 'assistant', text: 'Done.' }])
})

test('Codex rollout: id, folder and first real prompt', () => {
  const text = [
    JSON.stringify({ type: 'session_meta', payload: { id: 'abc-123-def', cwd: '/p' } }),
    JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>…' }] } }),
    JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'Add tests' } }),
    JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message', message: 'Added.' } }),
  ].join('\n')
  assert.deepEqual(codexMeta(text), { id: 'abc-123-def', cwd: '/p', title: 'Add tests' })
  assert.deepEqual(messagesOf('codex', text), [{ role: 'user', text: 'Add tests' }, { role: 'assistant', text: 'Added.' }])
})

test('agent output: Claude stream-json and Codex json events', () => {
  const run = (): Run => ({ id: 'r', accountId: 'a', service: 'claude', cwd: '/', prompt: 'hi', output: [], status: 'running' })
  const c = run()
  applyEvent(c, JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1' }))
  applyEvent(c, JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hello' }] } }))
  applyEvent(c, JSON.stringify({ type: 'result', is_error: false, result: 'Hello', session_id: 's1' }))
  assert.deepEqual([c.sessionId, c.status, c.output], ['s1', 'done', [{ role: 'assistant', text: 'Hello' }]])

  const x = run()
  applyEvent(x, JSON.stringify({ type: 'thread.started', thread_id: 't1' }))
  applyEvent(x, JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Hi' } }))
  applyEvent(x, JSON.stringify({ type: 'turn.failed', error: { message: 'quota' } }))
  assert.deepEqual([x.sessionId, x.status, x.error, x.output.length], ['t1', 'error', 'quota', 1])
})

test('a run\'s exact limits read back as usage', () => {
  const r: Run = { id: 'r', accountId: 'a', service: 'claude', cwd: '/', prompt: 'hi', output: [], status: 'running' }
  applyEvent(r, JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { unifiedWindows: { five_hour: { utilization: 0.65, resetsAt: NOW / 1000 + 600 }, seven_day: { utilization: 0.31, resetsAt: NOW / 1000 + 9000 } } } }))
  assert.deepEqual(parseClaudeStatus(limitsToStatus(r.limits!), NOW, NOW), { five: { percent: 65, resetsAt: NOW + 600_000 }, week: { percent: 31, resetsAt: NOW + 9_000_000 }, asOf: NOW })
})

test('auto-start time: after the reset, soon with no window, never twice in 10 minutes', () => {
  assert.equal(autoStartAt(NOW + 3600_000, undefined, undefined, NOW), NOW + 3660_000)
  assert.equal(autoStartAt(null, undefined, undefined, NOW), NOW + 60_000)
  assert.equal(autoStartAt(null, NOW + 30_000, undefined, NOW), NOW + 30_000) // a refresh keeps the pending time
  assert.equal(autoStartAt(null, undefined, NOW - 60_000, NOW), NOW + 540_000) // just sent: wait out the retry gap
})

test('copying a chat to another account brings its side folder and never overwrites', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, readFileSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const { copyChat } = await import('./sessions.ts')
  const root = mkdtempSync(join(tmpdir(), 'sm-copy-'))
  const src = join(root, 'a', 'projects', '-w', 's1.jsonl')
  mkdirSync(join(root, 'a', 'projects', '-w', 's1', 'tool-results'), { recursive: true })
  writeFileSync(src, '{"type":"user"}\n')
  writeFileSync(join(root, 'a', 'projects', '-w', 's1', 'tool-results', 'x.txt'), 'x')
  const dest = { id: 'b', service: 'claude' as const, name: 'B', dir: join(root, 'b'), isDefault: false }
  const target = copyChat(src, dest)
  assert.equal(readFileSync(target, 'utf8'), '{"type":"user"}\n')
  assert.equal(readFileSync(join(root, 'b', 'projects', '-w', 's1', 'tool-results', 'x.txt'), 'utf8'), 'x')
  assert.throws(() => copyChat(src, dest), /already has this chat/)
})
