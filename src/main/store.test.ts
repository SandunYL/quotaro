// Hooks against a throwaway home folder, never the real one.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'switch-man-'))
process.env.HOME = home
process.env.SHELL = '/bin/zsh'
const store = await import('./store.ts')

test('usage hook keeps the account\'s own status line and saves the reading', { skip: process.platform === 'win32' }, () => {
  mkdirSync(join(home, '.claude'))
  writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ statusLine: { type: 'command', command: 'echo MINE' } }))
  const s = store.loadState()
  store.enableTracking(s.accounts[0])
  store.enableTracking(s.accounts[0])
  const cmd = JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8')).statusLine.command
  const out = execFileSync('sh', ['-c', cmd], { input: '{"session_id":"abc-1","rate_limits":{}}', encoding: 'utf8' })
  assert.equal(out.trim(), 'MINE')
  assert.ok(existsSync(join(home, '.claude', '.switch-man-status', 'abc-1.json')))
  assert.ok(existsSync(join(home, '.claude', 'settings.json.switch-man-backup')))
})

test('shell hook is added once and env.sh quotes paths', { skip: process.platform === 'win32' }, async () => {
  store.linkShell(); store.linkShell()
  assert.equal(readFileSync(join(home, '.zshrc'), 'utf8').split('>>> switch-man').length - 1, 1)
  const s = store.loadState()
  s.accounts.push({ id: 'x', service: 'claude', name: 'x', dir: "/tmp/it's", isDefault: false })
  s.active.claude = 'x'
  await store.writeEnv(s)
  const env = execFileSync('sh', ['-c', `. ${join(home, '.switch-man', 'env.sh')}; printf %s "$CLAUDE_CONFIG_DIR"`], { encoding: 'utf8' })
  assert.equal(env, "/tmp/it's")
})
