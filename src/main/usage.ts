// Reads usage limits from files Claude Code and Codex already write. No network, no login tokens.
import { readFileSync, readdirSync, statSync, openSync, readSync, closeSync } from 'node:fs'
import { join } from 'node:path'
import type { Limit, Usage, Sample } from '../shared/types.ts'

export const STATUS_DIRS = ['.switch-man-status', '.accountdeck-status'] // AccountDeck's files still count

const readJson = (p: string): any => { try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return undefined } }
const mtime = (p: string) => { try { return statSync(p).mtimeMs } catch { return 0 } }

export function readTail(path: string, bytes: number): string {
  let fd: number | undefined
  try {
    fd = openSync(path, 'r')
    const size = statSync(path).size, len = Math.min(size, bytes), buf = Buffer.alloc(len)
    readSync(fd, buf, 0, len, size - len)
    return buf.toString('utf8')
  } catch { return '' } finally { if (fd !== undefined) closeSync(fd) }
}

export function readHead(path: string, bytes: number): string {
  let fd: number | undefined
  try {
    fd = openSync(path, 'r')
    const buf = Buffer.alloc(bytes), n = readSync(fd, buf, 0, bytes, 0)
    return buf.subarray(0, n).toString('utf8')
  } catch { return '' } finally { if (fd !== undefined) closeSync(fd) }
}

// A window whose reset time has passed has reset since the reading: show it as 0%.
function limit(percent: unknown, resetsAt: number | null, now: number): Limit | undefined {
  if (typeof percent !== 'number' || !isFinite(percent)) return undefined
  if (resetsAt !== null && resetsAt <= now) return { percent: 0, resetsAt: null }
  return { percent, resetsAt }
}

/** Claude Code status-line JSON → usage. Undefined when the session has no reading yet. */
export function parseClaudeStatus(json: any, asOf: number, now = Date.now()): Usage | undefined {
  const rl = json?.rate_limits
  if (!rl || typeof rl !== 'object' || !Object.keys(rl).length) return undefined
  const w = (x: any) => x && limit(x.used_percentage, typeof x.resets_at === 'number' ? x.resets_at * 1000 : null, now)
  return { five: w(rl.five_hour), week: w(rl.seven_day), asOf }
}

/**
 * When the auto-start message goes out: a minute after the 5-hour reset. With no window running, soon,
 * keeping an already-set time so each refresh doesn't push it back. Never within `retry` of the last send.
 */
export function autoStartAt(reset: number | null | undefined, pending: number | undefined, lastSent: number | undefined, now: number, delay = 60_000, retry = 600_000) {
  const at = reset && reset > now ? reset + delay : pending ?? now + delay
  return Math.max(at, (lastSent ?? 0) + retry)
}

/** A run's exact limits in status-line shape, so they are read like any other session's file. */
export function limitsToStatus(limits: Record<string, { utilization: number; resetsAt: number }>) {
  const w = (x?: { utilization: number; resetsAt: number }) => x && { used_percentage: Math.round(x.utilization * 1000) / 10, resets_at: x.resetsAt }
  return { session_id: 'switch-man-run', rate_limits: { five_hour: w(limits.five_hour), seven_day: w(limits.seven_day) } }
}

/** Newest reading among this Claude Code config folder's per-session status files. */
export function claudeUsage(cfgDir: string, now = Date.now()): Usage | undefined {
  const files = STATUS_DIRS.flatMap(d => {
    const dir = join(cfgDir, d)
    try { return readdirSync(dir).filter(f => f.endsWith('.json')).map(f => join(dir, f)) } catch { return [] }
  }).map(p => ({ p, t: mtime(p) })).sort((a, b) => b.t - a.t)
  for (const { p, t } of files.slice(0, 30)) {
    const u = parseClaudeStatus(readJson(p), t, now)
    if (u) return u
  }
}

/** One Codex log line holding `rate_limits` → usage. Without `now`, expiry is judged at the line's own time. */
export function parseCodexLine(line: string, fallbackTime: number, now?: number): Usage | undefined {
  let obj: any
  try { obj = JSON.parse(line) } catch { return undefined }
  const rl = find(obj, 'rate_limits')
  if (!rl || typeof rl !== 'object') return undefined
  const stamp = Date.parse(obj.timestamp) || fallbackTime
  const out: Usage = { asOf: stamp }
  for (const key of ['primary', 'secondary']) {
    const w = rl[key]
    if (!w) continue
    let resets: number | null = typeof w.resets_at === 'number' ? w.resets_at * 1000 : null
    if (resets === null && typeof w.resets_in_seconds === 'number') resets = stamp + w.resets_in_seconds * 1000
    const l = limit(w.used_percent, resets, now ?? stamp)
    if (!l) continue
    if ((w.window_minutes ?? 300) <= 1440) out.five = l; else out.week = l
  }
  return out.five || out.week ? out : undefined
}

function find(o: any, key: string): any {
  if (!o || typeof o !== 'object') return undefined
  if (o[key] != null) return o[key]
  for (const v of Object.values(o)) { const f = find(v, key); if (f !== undefined) return f }
}

/** Codex session logs, newest written first. */
export function codexLogs(codexHome: string, days = 7): { p: string; t: number }[] {
  const root = join(codexHome, 'sessions'), out: { p: string; t: number }[] = []
  const list = (d: string) => { try { return readdirSync(d).sort().reverse() } catch { return [] } }
  // shortcut: only the newest `days` day folders are scanned, so a session last written after a week-long pause is missed; walk everything if that bites.
  let dayDirs = 0
  for (const y of list(root)) for (const m of list(join(root, y))) for (const d of list(join(root, y, m))) {
    if (days && dayDirs++ >= days) break
    for (const f of list(join(root, y, m, d))) if (f.endsWith('.jsonl')) out.push({ p: join(root, y, m, d, f), t: mtime(join(root, y, m, d, f)) })
  }
  return out.sort((a, b) => b.t - a.t)
}

export function codexUsage(codexHome: string, now = Date.now()): Usage | undefined {
  for (const { p, t } of codexLogs(codexHome).slice(0, 6)) {
    const lines = readTail(p, 600_000).split('\n')
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].includes('"rate_limits"')) continue
      const u = parseCodexLine(lines[i], t, now)
      if (u) return u
    }
  }
}

/** Email and Claude account id behind a Claude Code login. */
export function claudeIdentity(cfgDir: string, isDefault: boolean, home: string) {
  const j = readJson(isDefault ? join(home, '.claude.json') : join(cfgDir, '.claude.json'))
  const o = j?.oauthAccount
  return { email: o?.emailAddress as string | undefined, accountUuid: o?.accountUuid as string | undefined }
}

/** Email claim from Codex's id token (decoded locally, never sent anywhere). */
export function codexEmail(codexHome: string): string | undefined {
  const tok = readJson(join(codexHome, 'auth.json'))?.tokens?.id_token
  if (typeof tok !== 'string') return undefined
  try { return JSON.parse(Buffer.from(tok.split('.')[1], 'base64url').toString()).email } catch { return undefined }
}

/** History samples already on disk: every Claude status file and every Codex rate-limit line. */
export function backfill(accounts: { id: string; service: string; dir: string }[]): Sample[] {
  const out: Sample[] = []
  const push = (a: string, u: Usage | undefined, t: number) => {
    if (u?.five) out.push({ t, a, k: '5h', p: u.five.percent })
    if (u?.week) out.push({ t, a, k: 'week', p: u.week.percent })
  }
  for (const acc of accounts) {
    if (acc.service === 'claude') {
      for (const d of STATUS_DIRS) {
        const dir = join(acc.dir, d)
        let files: string[] = []
        try { files = readdirSync(dir).filter(f => f.endsWith('.json')) } catch {}
        // Each file's numbers were true when it was written, so judge expiry at that moment.
        for (const f of files) { const t = mtime(join(dir, f)); push(acc.id, parseClaudeStatus(readJson(join(dir, f)), t, t), t) }
      }
    } else {
      for (const { p, t } of codexLogs(acc.dir, 0)) {
        for (const line of readFileSafe(p).split('\n')) {
          if (!line.includes('"rate_limits"')) continue
          const u = parseCodexLine(line, t)
          if (u) push(acc.id, u, u.asOf)
        }
      }
    }
  }
  return out.sort((x, y) => x.t - y.t)
}

const readFileSafe = (p: string) => { try { return readFileSync(p, 'utf8') } catch { return '' } }

/** Drops samples that repeat the previous value of the same account and window. */
export function dedupe(samples: Sample[], last = new Map<string, number>()): Sample[] {
  return samples.filter(s => {
    const key = `${s.a}:${s.k}`
    if (last.get(key) === s.p) return false
    last.set(key, s.p)
    return true
  })
}
