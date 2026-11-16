// Accounts on disk: state.json, the shell hook that switches accounts, the usage hook, and terminals.
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, copyFileSync, readdirSync, statSync, rmSync, chmodSync, renameSync } from 'node:fs'
import { execFile, spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { join, sep } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { Account, Service } from '../shared/types.ts'
import { STATUS_DIRS } from './usage.ts'

export const HOME = homedir()
export const ROOT = join(HOME, '.switch-man')
const STATE = join(ROOT, 'state.json')
const ENV_SH = join(ROOT, 'env.sh')
const STATUS_SCRIPT = join(ROOT, 'claude-status.sh')
const MARK = '# >>> switch-man >>>'
const WIN = process.platform === 'win32'

export const ENV_VAR: Record<Service, string> = { claude: 'CLAUDE_CONFIG_DIR', codex: 'CODEX_HOME' }

export interface State {
  accounts: Account[]
  active: Record<Service, string>
  bells: Record<string, boolean>
  autoStart?: Record<string, string>
  backfilled?: boolean
}

export const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

const defaults = (): Account[] => [
  { id: 'claude-default', service: 'claude', name: 'Main', dir: join(HOME, '.claude'), isDefault: true },
  { id: 'codex-default', service: 'codex', name: 'Main', dir: join(HOME, '.codex'), isDefault: true },
]

/** A fresh state, starting from accounts already added in AccountDeck so its users don't sign in again. */
function initialState(): State {
  const s: State = { accounts: defaults(), active: { claude: 'claude-default', codex: 'codex-default' }, bells: {} }
  try {
    const ad = JSON.parse(readFileSync(join(HOME, '.accountdeck', 'state.json'), 'utf8'))
    for (const a of ad.accounts ?? []) {
      if (a.isDefault || (a.service !== 'claude' && a.service !== 'codex') || !existsSync(a.dir)) continue
      s.accounts.push({ id: String(a.id), service: a.service, name: String(a.name), dir: String(a.dir), isDefault: false })
    }
    for (const svc of ['claude', 'codex'] as Service[]) if (s.accounts.some(a => a.id === ad.active?.[svc])) s.active[svc] = ad.active[svc]
  } catch {}
  return s
}

export function loadState(): State {
  mkdirSync(ROOT, { recursive: true })
  try {
    const s = JSON.parse(readFileSync(STATE, 'utf8')) as State
    for (const d of defaults()) if (!s.accounts.some(a => a.id === d.id)) s.accounts.unshift(d)
    s.bells ??= {}
    return s
  } catch (e: any) {
    // A corrupt state file is kept aside rather than overwritten.
    if (e.code !== 'ENOENT') copyFileSync(STATE, `${STATE}.broken-${Date.now()}`)
    const s = initialState()
    saveState(s)
    return s
  }
}

export function saveState(s: State) {
  writeFileSync(STATE + '.tmp', JSON.stringify(s, null, 2))
  // rename is atomic, so a crash never leaves half a state file.
  renameSync(STATE + '.tmp', STATE)
}

export function newAccount(service: Service, name: string): Account {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'account'
  const id = `${service}-${slug}-${randomBytes(2).toString('hex')}`
  const dir = join(ROOT, service, id)
  mkdirSync(dir, { recursive: true })
  return { id, service, name, dir, isDefault: false }
}

export const ownsDir = (dir: string) => dir.startsWith(ROOT + sep)

// ---- Switching ----

/** Points new terminals at the active accounts. Unix: env.sh, read by the shell hook. Windows: user env vars. */
export async function writeEnv(s: State) {
  const pick = (svc: Service) => s.accounts.find(a => a.id === s.active[svc] && !a.isDefault)
  if (WIN) {
    for (const svc of ['claude', 'codex'] as Service[]) {
      const a = pick(svc), v = ENV_VAR[svc]
      const args = a ? [v, a.dir] : null
      await new Promise<void>(res => args
        ? execFile('setx', args, () => res())
        : execFile('reg', ['delete', 'HKCU\\Environment', '/F', '/V', v], () => res()))
    }
    return
  }
  const lines = ['# Written by Quotaro. Change accounts in the app.']
  for (const svc of ['claude', 'codex'] as Service[]) {
    const a = pick(svc), v = ENV_VAR[svc]
    lines.push(a ? `export ${v}=${shq(a.dir)}` : `unset ${v}`)
  }
  writeFileSync(ENV_SH, lines.join('\n') + '\n')
}

function rcFiles(): { path: string; kind: 'zsh' | 'bash' }[] {
  if (WIN) return []
  const shell = process.env.SHELL ?? ''
  const zsh = join(process.env.ZDOTDIR || HOME, '.zshrc'), bash = join(HOME, '.bashrc')
  const out: { path: string; kind: 'zsh' | 'bash' }[] = []
  if (shell.endsWith('zsh') || existsSync(zsh) || process.platform === 'darwin') out.push({ path: zsh, kind: 'zsh' })
  if (shell.endsWith('bash') || existsSync(bash)) out.push({ path: bash, kind: 'bash' })
  return out
}

const read = (p: string) => { try { return readFileSync(p, 'utf8') } catch { return '' } }

export const shellLinked = () => WIN || rcFiles().every(f => read(f.path).includes(MARK))

/** Adds a hook that re-reads env.sh before every prompt. Appends, so a symlinked rc file stays a symlink. */
export function linkShell() {
  const fn = `_switchman_env() { [ -f "$HOME/.switch-man/env.sh" ] && . "$HOME/.switch-man/env.sh"; }`
  for (const { path, kind } of rcFiles()) {
    const text = read(path)
    if (text.includes(MARK)) continue
    if (text && !existsSync(path + '.switch-man-backup')) copyFileSync(path, path + '.switch-man-backup')
    const hook = kind === 'zsh'
      ? 'autoload -Uz add-zsh-hook && add-zsh-hook precmd _switchman_env'
      : 'PROMPT_COMMAND="_switchman_env${PROMPT_COMMAND:+;$PROMPT_COMMAND}"'
    appendFileSync(path, `\n${MARK}\n# Re-reads the active Claude Code / Codex account before every prompt.\n${fn}\n${hook}\n_switchman_env\n# <<< switch-man <<<\n`)
  }
}

// ---- Usage tracking (Claude Code status line) ----

// Saves each session's status JSON for Quotaro, then runs the account's own status line, if it had one.
const SCRIPT = `#!/bin/sh
# Quotaro: saves Claude Code's status-line JSON (usage limits) per session.
d="$1"; s="$d/.switch-man-status"
input=$(cat)
sid=$(printf '%s' "$input" | sed -n 's/.*"session_id" *: *"\\([A-Za-z0-9_-]*\\)".*/\\1/p' | head -n 1)
if [ -n "$sid" ]; then
  mkdir -p "$s"
  printf '%s' "$input" > "$s/.$sid.tmp" && mv -f "$s/.$sid.tmp" "$s/$sid.json"
  find "$s" -name '*.json' -mtime +8 -delete 2>/dev/null
fi
if [ -f "$s/prev-command" ]; then printf '%s' "$input" | sh -c "$(cat "$s/prev-command")"; fi
exit 0
`

const settingsPath = (a: Account) => join(a.dir, 'settings.json')

export function hasTracking(a: Account) {
  if (read(settingsPath(a)).includes('.switch-man')) return true
  // AccountDeck's hook writes the same files, which Quotaro reads too.
  return read(settingsPath(a)).includes('claude-status.sh') && existsSync(join(a.dir, STATUS_DIRS[1]))
}

export function enableTracking(a: Account) {
  if (a.service !== 'claude' || hasTracking(a)) return
  writeFileSync(STATUS_SCRIPT, SCRIPT)
  chmodSync(STATUS_SCRIPT, 0o755)
  mkdirSync(join(a.dir, '.switch-man-status'), { recursive: true })
  const path = settingsPath(a), text = read(path)
  let json: any = {}
  if (text) {
    json = JSON.parse(text) // throws on a broken file rather than replacing it
    if (!existsSync(path + '.switch-man-backup')) copyFileSync(path, path + '.switch-man-backup')
  }
  const prev = json.statusLine?.command
  if (typeof prev === 'string' && prev.trim()) writeFileSync(join(a.dir, '.switch-man-status', 'prev-command'), prev)
  json.statusLine = { ...json.statusLine, type: 'command', command: `sh ${shq(STATUS_SCRIPT)} ${shq(a.dir)}` }
  writeFileSync(path, JSON.stringify(json, null, 2) + '\n')
}

// ---- Terminals ----

/** Opens a terminal window that runs one command for an account. Words must be safe (no user text). */
export async function runInTerminal(a: Account, words: string[], cwd: string | undefined, openPath: (p: string) => Promise<string>) {
  const dir = join(ROOT, 'run')
  mkdirSync(dir, { recursive: true })
  const v = ENV_VAR[a.service], file = join(dir, randomBytes(4).toString('hex') + (WIN ? '.cmd' : process.platform === 'darwin' ? '.command' : '.sh'))
  if (WIN) {
    const lines = ['@echo off', cwd ? `cd /d "${cwd}"` : '', a.isDefault ? `set ${v}=` : `set "${v}=${a.dir}"`, words.join(' '), 'pause']
    writeFileSync(file, lines.join('\r\n'))
    return void (await openPath(file))
  }
  const lines = [
    process.platform === 'darwin' ? '#!/bin/zsh -il' : '#!/bin/sh',
    `printf '\\033]0;Quotaro: ${a.service} ${a.id}\\007'`,
    cwd ? `cd ${shq(cwd)}` : '',
    a.isDefault ? `unset ${v}` : `export ${v}=${shq(a.dir)}`,
    words.join(' '),
  ]
  if (process.platform !== 'darwin') lines.push(`printf '\\nPress Enter to close. '; read _`)
  writeFileSync(file, lines.join('\n') + '\n', { mode: 0o755 })
  if (process.platform === 'darwin') return void (await openPath(file))
  // Linux: the first terminal found. The user's login shell isn't sourced, so PATH comes from the app.
  const terms: [string, string[]][] = [['x-terminal-emulator', ['-e']], ['gnome-terminal', ['--']], ['konsole', ['-e']], ['xfce4-terminal', ['-x']], ['kitty', []], ['alacritty', ['-e']], ['xterm', ['-e']]]
  for (const [t, flag] of terms) {
    const ok = await new Promise<boolean>(res => execFile('sh', ['-c', `command -v ${t}`], e => res(!e)))
    if (!ok) continue
    spawn(t, [...flag, 'sh', file], { detached: true, stdio: 'ignore' }).unref()
    return
  }
  throw new Error('No terminal app found')
}

/** Old terminal scripts. They aren't deleted right away because the terminal reads them after launch. */
export function cleanRunDir() {
  const dir = join(ROOT, 'run')
  try { for (const f of readdirSync(dir)) if (Date.now() - statSync(join(dir, f)).mtimeMs > 3600_000) rmSync(join(dir, f)) } catch {}
}

export const HISTORY = join(ROOT, 'history.jsonl')
