// Chats and agents: lists Claude Code / Codex sessions from their logs, and runs owned agents.
import { readdirSync, statSync, existsSync, mkdirSync, copyFileSync, cpSync } from 'node:fs'
import { spawn, type ChildProcess } from 'node:child_process'
import { join, basename, dirname, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Account, Msg, Run, Session } from '../shared/types.ts'
import { readHead, readTail, codexLogs } from './usage.ts'

const LIVE_MS = 2 * 60_000
const WEEK_MS = 7 * 24 * 3600_000
export const SESSION_ID = /^[A-Za-z0-9-]{8,64}$/

const parse = (l: string): any => { try { return JSON.parse(l) } catch { return undefined } }
const clean = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 120)

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.filter((c: any) => ['text', 'input_text', 'output_text'].includes(c?.type)).map((c: any) => c.text).join('\n')
}
// Wrapper lines (slash commands, environment context, caveats) are not what anyone typed.
const isPrompt = (t: string) => !!t.trim() && !t.trimStart().startsWith('<') && !t.startsWith('Caveat:')

/** Title, folder and session id from a Claude Code transcript. */
export function claudeMeta(text: string) {
  let custom: string | undefined, ai: string | undefined, first: string | undefined, cwd: string | undefined
  for (const line of text.split('\n')) {
    const isTitle = line.includes('"custom-title"') || line.includes('"ai-title"')
    const needUser = !first && line.includes('"type":"user"')
    if (!isTitle && !needUser && (cwd || !line.includes('"cwd"'))) continue
    const o = parse(line)
    if (!o) continue
    cwd ??= o.cwd
    if (typeof o.customTitle === 'string') custom = o.customTitle
    if (typeof o.aiTitle === 'string') ai = o.aiTitle
    if (needUser && o.type === 'user') { const t = textOf(o.message?.content); if (isPrompt(t)) first = t }
  }
  return { title: custom ?? ai ?? first, cwd }
}

/** Title, folder and session id from a Codex rollout log. */
export function codexMeta(text: string) {
  let id: string | undefined, cwd: string | undefined, first: string | undefined
  for (const line of text.split('\n')) {
    if (!line.includes('session_meta') && (first || !line.includes('"user'))) continue
    const o = parse(line), p = o?.payload
    if (!p) continue
    if (o.type === 'session_meta') { id ??= p.id; cwd ??= p.cwd }
    else if (!first && p.type === 'user_message' && isPrompt(p.message ?? '')) first = p.message
    else if (!first && p.type === 'message' && p.role === 'user') { const t = textOf(p.content); if (isPrompt(t)) first = t }
  }
  return { id, cwd, title: first }
}

/** Last messages of a transcript, oldest first. */
export function messagesOf(service: Account['service'], text: string, max = 40): Msg[] {
  const out: Msg[] = [], fallback: Msg[] = []
  for (const line of text.split('\n')) {
    const o = parse(line)
    if (!o) continue
    if (service === 'claude') {
      if (o.type !== 'user' && o.type !== 'assistant') continue
      const t = textOf(o.message?.content)
      if (o.isMeta || !isPrompt(t)) continue
      out.push({ role: o.type, text: t })
    } else {
      const p = o.payload
      if (p?.type === 'user_message' && isPrompt(p.message ?? '')) out.push({ role: 'user', text: p.message })
      else if (p?.type === 'agent_message' && p.message) out.push({ role: 'assistant', text: p.message })
      else if (p?.type === 'message' && (p.role === 'user' || p.role === 'assistant')) {
        const t = textOf(p.content)
        if (isPrompt(t)) fallback.push({ role: p.role, text: t })
      }
    }
  }
  return (out.length ? out : fallback).slice(-max)
}

const metaCache = new Map<string, { mtime: number; title?: string; cwd?: string; id?: string }>()

export function listSessions(accounts: Account[], runs: Run[], now = Date.now()): Session[] {
  const files: { a: Account; p: string; t: number }[] = []
  for (const a of accounts) {
    if (a.service === 'claude') {
      const root = join(a.dir, 'projects')
      let dirs: string[] = []
      try { dirs = readdirSync(root) } catch {}
      for (const d of dirs) {
        let fs: string[] = []
        try { fs = readdirSync(join(root, d)) } catch {}
        for (const f of fs) if (f.endsWith('.jsonl')) {
          const p = join(root, d, f)
          try { const st = statSync(p); if (st.size && now - st.mtimeMs < WEEK_MS) files.push({ a, p, t: st.mtimeMs }) } catch {}
        }
      }
    } else for (const { p, t } of codexLogs(a.dir)) if (now - t < WEEK_MS) files.push({ a, p, t })
  }
  const running = new Set(runs.filter(r => r.status === 'running').map(r => r.sessionId))
  return files.sort((x, y) => y.t - x.t).slice(0, 80).map(({ a, p, t }) => {
    let m = metaCache.get(p)
    if (!m || m.mtime !== t) {
      const text = readHead(p, 96_000) + '\n' + readTail(p, 64_000)
      m = a.service === 'claude' ? { mtime: t, ...claudeMeta(text) } : { mtime: t, ...codexMeta(text) }
      metaCache.set(p, m)
    }
    const id = a.service === 'claude' ? basename(p, '.jsonl') : m.id ?? basename(p, '.jsonl').slice(-36)
    return {
      id, path: p, service: a.service, accountId: a.id,
      title: clean(m.title ?? 'Untitled chat'), cwd: m.cwd ?? '', mtime: t,
      live: now - t < LIVE_MS || running.has(id),
    }
  })
}

/** The path must be a log inside one of the accounts' folders: the renderer never names arbitrary files. */
export function ownedLog(accounts: Account[], path: string): Account {
  const a = accounts.find(a => path.startsWith(a.dir + sep) && path.endsWith('.jsonl') && !path.includes('..'))
  if (!a || !existsSync(path)) throw new Error('Unknown chat')
  return a
}

/** Copies a Claude Code chat into another account so it can be resumed there. Never overwrites. */
export function copyChat(src: string, dest: Account): string {
  const target = join(dest.dir, 'projects', basename(dirname(src)), basename(src))
  if (existsSync(target)) throw new Error('That account already has this chat')
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(src, target)
  const side = src.slice(0, -'.jsonl'.length)
  if (existsSync(side)) cpSync(side, target.slice(0, -'.jsonl'.length), { recursive: true, errorOnExist: false, force: false })
  return target
}

// ---- Owned agents ----

const procs = new Map<string, ChildProcess>()

export function envFor(a: Account): NodeJS.ProcessEnv {
  const env = { ...process.env }
  const v = a.service === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME'
  if (a.isDefault) delete env[v]; else env[v] = a.dir
  return env
}

/** One line of `claude -p --output-format stream-json` or `codex exec --json` output, applied to a run. */
export function applyEvent(run: Run, line: string) {
  const o = parse(line)
  if (!o) return
  const say = (text: unknown) => { if (typeof text === 'string' && text.trim()) run.output.push({ role: 'assistant', text }) }
  // Claude Code
  if (o.session_id && !run.sessionId) run.sessionId = o.session_id
  if (o.type === 'assistant') say(textOf(o.message?.content))
  if (o.type === 'rate_limit_event' && o.rate_limit_info?.unifiedWindows) run.limits = o.rate_limit_info.unifiedWindows
  if (o.type === 'result') { run.status = o.is_error ? 'error' : 'done'; if (o.is_error) run.error = o.result ?? o.subtype }
  // Codex (current and older event shapes)
  if (o.type === 'thread.started' && o.thread_id) run.sessionId ??= o.thread_id
  if (o.type === 'item.completed' && o.item?.type === 'agent_message') say(o.item.text)
  if (o.msg?.type === 'agent_message') say(o.msg.message)
  if (o.type === 'turn.failed' || o.type === 'error') { run.status = 'error'; run.error = o.error?.message ?? o.message }
}

export function startRun(a: Account, cwd: string, prompt: string, sessionId: string | undefined, onChange: (r: Run) => void): Run {
  if (sessionId && !SESSION_ID.test(sessionId)) throw new Error('Bad session id')
  if (!existsSync(cwd)) throw new Error(`Folder not found: ${cwd}`)
  const run: Run = { id: randomUUID(), accountId: a.id, service: a.service, cwd, sessionId, prompt, output: [{ role: 'user', text: prompt }], status: 'running' }
  // The prompt goes through stdin, so it never meets a shell (Windows needs one for npm's .cmd shims).
  const args = a.service === 'claude'
    ? ['-p', '--output-format', 'stream-json', '--verbose', ...(sessionId ? ['--resume', sessionId] : [])]
    : ['exec', '--json', '--skip-git-repo-check', ...(sessionId ? ['resume', sessionId] : []), '-']
  const child = spawn(a.service, args, { cwd, env: envFor(a), shell: process.platform === 'win32', windowsHide: true })
  procs.set(run.id, child)
  let buf = '', errText = ''
  child.stdout.on('data', d => {
    buf += d
    const lines = buf.split('\n'); buf = lines.pop()!
    lines.forEach(l => applyEvent(run, l))
    onChange(run)
  })
  child.stderr.on('data', d => { errText = (errText + d).slice(-2000) })
  child.on('error', e => { run.status = 'error'; run.error = e.message.includes('ENOENT') ? `${a.service} is not installed or not on PATH` : e.message; onChange(run) })
  child.on('close', code => {
    procs.delete(run.id)
    if (buf) applyEvent(run, buf)
    if (run.status === 'running') { run.status = code === 0 ? 'done' : 'error'; if (code) run.error ??= errText.trim() || `Exited with code ${code}` }
    onChange(run)
  })
  child.stdin.end(prompt)
  return run
}

export function stopRun(id: string) { procs.get(id)?.kill() }
export function stopAll() { for (const p of procs.values()) p.kill() }
