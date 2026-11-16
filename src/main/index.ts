import { app, BrowserWindow, ipcMain, Menu, Notification, Tray, dialog, nativeImage, shell } from 'electron'
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AccountView, AppState, Msg, Run, Sample, Service, WindowKind } from '../shared/types.ts'
import { backfill, claudeIdentity, claudeUsage, codexEmail, codexUsage, dedupe, limitsToStatus, readTail, autoStartAt } from './usage.ts'
import * as store from './store.ts'
import { copyChat, listSessions, messagesOf, ownedLog, startRun, stopAll, stopRun, SESSION_ID } from './sessions.ts'

// One switch-man per user: a second launch just focuses the existing window.
if (!app.requestSingleInstanceLock()) app.quit()

// Apps opened from the Dock or a launcher get a bare PATH; agents need the one the user's shell has.
if (process.platform !== 'win32') {
  try {
    const out = execFileSync(process.env.SHELL || '/bin/sh', ['-ilc', 'printf "__SMPATH__%s__SMPATH__" "$PATH"'], { timeout: 4000, encoding: 'utf8' })
    const path = out.split('__SMPATH__')[1]
    if (path) process.env.PATH = path
  } catch {}
}

const TRAY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAA7UlEQVR42mNgGAWjYBQQBlxAbATE9iRiI6heskEUEO8G4v8U4t1Qs4gGqlSyGJtDVAlZDgq2Z0iangNxDxAHkxEFwVC9z5HMewa1A2dc30BSDNLMTIU0xAw1C2buDVxpYyKSokoyLRMG4mQgrofSwkhylUjmT0TXKI4kuZFMy0EWfkeL9+9QcRjYiCQnjqw5A0nCngzLPQgkQA+oOnsksQxkA+YjJTpywE4CDtiJpBaWKOcjGwDLdofJdMB3Ag74jqT2MFK2HDwOGPAoGPBEOODZcMALokFRFA94ZTQoquNB0SAZNE2yUTAKRgYAAJrz8ztZvlEmAAAAAElFTkSuQmCC'
const SERVICE_NAME: Record<Service, string> = { claude: 'Claude', codex: 'Codex' }
const WINDOW_NAME: Record<WindowKind, string> = { '5h': '5-hour', week: 'weekly' }

let win: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
const state = store.loadState()
let views: AccountView[] = []
const runs = new Map<string, Run>()

// ---- Refresh: accounts, usage, history, alerts ----

const lastSample = new Map<string, number>()

function loadHistory(): Sample[] {
  try {
    return readFileSync(store.HISTORY, 'utf8').split('\n').flatMap(l => { try { return [JSON.parse(l) as Sample] } catch { return [] } })
  } catch { return [] }
}

function initHistory() {
  if (!state.backfilled) {
    const old = dedupe(backfill(state.accounts))
    if (old.length) appendFileSync(store.HISTORY, old.map(s => JSON.stringify(s)).join('\n') + '\n')
    state.backfilled = true
    store.saveState(state)
  }
  dedupe(loadHistory(), lastSample) // primes the last value per account and window
}

function record(v: AccountView) {
  const u = v.usage
  if (!u) return
  const fresh = dedupe([
    ...(u.five ? [{ t: u.asOf, a: v.id, k: '5h' as const, p: u.five.percent }] : []),
    ...(u.week ? [{ t: u.asOf, a: v.id, k: 'week' as const, p: u.week.percent }] : []),
  ], lastSample)
  if (fresh.length) appendFileSync(store.HISTORY, fresh.map(s => JSON.stringify(s)).join('\n') + '\n')
}

function refresh() {
  views = state.accounts.map(a => {
    const v: AccountView = { ...a, active: state.active[a.service] === a.id, exists: existsSync(a.dir) }
    if (!v.exists) return v
    if (a.service === 'claude') {
      Object.assign(v, claudeIdentity(a.dir, a.isDefault, store.HOME))
      v.usage = claudeUsage(a.dir)
      v.tracking = store.hasTracking(a)
    } else {
      v.email = codexEmail(a.dir)
      v.usage = codexUsage(a.dir)
    }
    return v
  })
  // Logins on the same Claude account share limits: the newest reading wins for all of them.
  for (const v of views) {
    if (!v.accountUuid) continue
    const best = views.filter(o => o.accountUuid === v.accountUuid && o.usage).sort((x, y) => y.usage!.asOf - x.usage!.asOf)[0]
    if (best) v.usage = best.usage
  }
  views.forEach(record)
  scheduleTimers()
  updateTray()
  push()
}

function snapshot(): AppState {
  const login = process.platform === 'linux' ? null : app.getLoginItemSettings().openAtLogin
  return { platform: process.platform, accounts: views, shellLinked: store.shellLinked(), bells: state.bells, loginItem: login, autoStart: state.autoStart ?? {}, nextAuto, runs: [...runs.values()] }
}

const push = () => win?.webContents.send('state', snapshot())

// A reset writes no file, so timers fire at reset times: alerts, and auto-start messages.
// Keyed by Claude account, so logins that share one account act once.
const timers = new Map<string, { at: number; timer: NodeJS.Timeout }>()
const lastAuto = new Map<string, number>()
let nextAuto: Record<string, number> = {}

function scheduleTimers() {
  const now = Date.now(), want = new Map<string, { at: number; fire: () => void }>()
  for (const v of views) for (const k of ['5h', 'week'] as WindowKind[]) {
    const at = (k === '5h' ? v.usage?.five : v.usage?.week)?.resetsAt
    if (!state.bells[`${v.id}:${k}`] || !at || at <= now) continue
    want.set(`${v.accountUuid ?? v.id}:${k}`, { at: at + 1000, fire: () => {
      new Notification({ title: `${SERVICE_NAME[v.service]} limit reset`, body: `${v.name}${v.email ? ` (${v.email})` : ''}: the ${WINDOW_NAME[k]} limit is back to 0%.` }).show()
    } })
  }
  nextAuto = {}
  for (const v of views) {
    const message = state.autoStart?.[v.id], key = `auto:${v.accountUuid ?? v.id}`
    if (message === undefined || v.service !== 'claude' || !v.exists || want.has(key)) continue
    const at = autoStartAt(v.usage?.five?.resetsAt, timers.get(key)?.at, lastAuto.get(key), now)
    nextAuto[v.id] = at
    want.set(key, { at, fire: () => {
      lastAuto.set(key, Date.now())
      onRun(startRun(v, store.ROOT, message, undefined, onRun))
      new Notification({ title: 'New Claude session started', body: `${v.name}: sent "${message}" right after the 5-hour reset.` }).show()
    } })
  }
  for (const [key, t] of timers) if (want.get(key)?.at !== t.at) { clearTimeout(t.timer); timers.delete(key) }
  for (const [key, { at, fire }] of want) {
    if (timers.has(key)) continue
    const timer = setTimeout(() => { timers.delete(key); try { fire() } catch (e) { console.error(e) } refresh() }, Math.min(Math.max(0, at - now), 2 ** 31 - 1))
    timers.set(key, { at, timer })
  }
}

// ---- Tray ----

let trayKey = ''
function updateTray() {
  if (!tray) return
  const pct = (v: AccountView) => v.usage?.five ? ` · ${Math.round(v.usage.five.percent)}%` : ''
  const items: Electron.MenuItemConstructorOptions[] = []
  for (const svc of ['claude', 'codex'] as Service[]) {
    const accs = views.filter(v => v.service === svc && v.exists)
    if (accs.length < 2) continue
    items.push({ label: svc === 'claude' ? 'Claude Code' : 'Codex', enabled: false })
    for (const v of accs) items.push({ label: v.name + pct(v), type: 'radio', checked: v.active, click: () => api.select(v.id) })
    items.push({ type: 'separator' })
  }
  items.push({ label: 'Open switch-man', click: showWindow }, { label: 'Quit', role: 'quit' })
  const key = JSON.stringify(items.map(i => [i.label, i.checked]))
  if (key === trayKey) return // rebuilding an unchanged menu flickers on Linux
  trayKey = key
  tray.setContextMenu(Menu.buildFromTemplate(items))
}

// ---- Window ----

function createWindow(show = true) {
  win = new BrowserWindow({
    width: 1120,
    height: 740,
    minWidth: 860,
    minHeight: 560,
    show: false,
    backgroundColor: '#07070d',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: true },
  })
  if (show) win.once('ready-to-show', () => win?.show())
  // Closing hides: the app keeps running in the tray so reset alerts still fire.
  win.on('close', e => { if (!quitting) { e.preventDefault(); win?.hide() } })
  win.on('focus', refresh)
  win.webContents.setWindowOpenHandler(({ url }) => { if (url.startsWith('https://')) shell.openExternal(url); return { action: 'deny' } })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

function showWindow() {
  if (!win) return createWindow()
  if (win.isMinimized()) win.restore()
  win.show(); win.focus()
}

// ---- API for the renderer ----

const account = (id: unknown) => {
  const a = state.accounts.find(a => a.id === id)
  if (!a) throw new Error('Unknown account')
  return a
}
const save = () => { store.saveState(state); refresh() }
const onRun = (r: Run) => {
  runs.set(r.id, r)
  win?.webContents.send('run', r)
  // A finished Claude run carries exact limits: save them like a session status file, then re-read.
  const a = state.accounts.find(a => a.id === r.accountId)
  if (r.limits && r.status !== 'running' && a?.service === 'claude') {
    const dir = join(a.dir, '.switch-man-status')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'switch-man-run.json'), JSON.stringify(limitsToStatus(r.limits)))
    refresh()
  }
}

const api = {
  state: () => snapshot(),
  refresh: () => { refresh(); return snapshot() },

  async addAccount(service: Service, name: string) {
    if (service !== 'claude' && service !== 'codex') throw new Error('Unknown app')
    name = String(name).trim().slice(0, 40)
    if (!name) throw new Error('Give the account a name')
    const a = store.newAccount(service, name)
    state.accounts.push(a)
    if (service === 'claude') store.enableTracking(a)
    save()
    await api.signIn(a.id)
  },
  rename(id: string, name: string) {
    const a = account(id)
    name = String(name).trim().slice(0, 40)
    if (!name) throw new Error('Name cannot be empty')
    a.name = name
    save()
  },
  async remove(id: string) {
    const a = account(id)
    if (a.isDefault) throw new Error('The Main account cannot be removed')
    // Only folders switch-man created go to the Trash; an imported AccountDeck folder is just forgotten.
    if (store.ownsDir(a.dir) && existsSync(a.dir)) await shell.trashItem(a.dir)
    state.accounts = state.accounts.filter(x => x !== a)
    if (state.active[a.service] === id) state.active[a.service] = `${a.service}-default`
    for (const k of Object.keys(state.bells)) if (k.startsWith(id + ':')) delete state.bells[k]
    if (state.autoStart) delete state.autoStart[id]
    await store.writeEnv(state)
    save()
  },
  async select(id: string) {
    const a = account(id)
    state.active[a.service] = a.id
    await store.writeEnv(state)
    save()
  },
  signIn: (id: string) => {
    const a = account(id)
    return store.runInTerminal(a, a.service === 'claude' ? ['claude', '/login'] : ['codex', 'login'], undefined, shell.openPath)
  },
  reveal: (id: string) => { const a = account(id); if (existsSync(a.dir)) shell.showItemInFolder(a.dir) },
  revealData: () => shell.openPath(store.ROOT),
  async linkShell() { store.linkShell(); await store.writeEnv(state); push() },
  enableTracking(id: string) { store.enableTracking(account(id)); refresh() },
  setBell(key: string, on: boolean) {
    const [id, k] = String(key).split(':')
    account(id)
    if (k !== '5h' && k !== 'week') throw new Error('Unknown limit')
    if (on) state.bells[key] = true; else delete state.bells[key]
    save()
  },
  setAutoStart(id: string, message: string | null) {
    const a = account(id)
    if (a.service !== 'claude') throw new Error('Auto-start is for Claude Code accounts')
    state.autoStart ??= {}
    if (message === null) delete state.autoStart[id]
    else state.autoStart[id] = String(message).trim().slice(0, 500) || 'hi'
    save()
  },
  setLoginItem(on: boolean) { app.setLoginItemSettings({ openAtLogin: !!on, args: ['--hidden'] }); push() },

  history(): Sample[] {
    const since = Date.now() - 30 * 24 * 3600_000
    return loadHistory().filter(s => s.t >= since)
  },
  sessions: () => listSessions(state.accounts.filter(a => existsSync(a.dir)), [...runs.values()]),
  messages(path: string) {
    const a = ownedLog(state.accounts, path)
    // Lines holding screenshots run to megabytes, so read further back until there is enough to show.
    let msgs: Msg[] = []
    for (const bytes of [400_000, 4_000_000, 24_000_000]) {
      msgs = messagesOf(a.service, readTail(path, bytes))
      if (msgs.length >= 20 || bytes >= statSync(path).size) break
    }
    return msgs
  },
  async pickFolder() {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  },
  send(accountId: string, cwd: string, prompt: string, sessionId?: string) {
    prompt = String(prompt).trim()
    if (!prompt) throw new Error('Type a message first')
    const r = startRun(account(accountId), String(cwd), prompt, sessionId || undefined, onRun)
    onRun(r)
    return r.id
  },
  stop: (runId: string) => stopRun(runId),
  dismissRun(runId: string) { if (runs.get(runId)?.status !== 'running') runs.delete(runId); push() },
  copyChat(path: string, destId: string) {
    const src = ownedLog(state.accounts, path), dest = account(destId)
    if (src.service !== 'claude' || dest.service !== 'claude') throw new Error('Only Claude Code chats can be copied')
    if (src.id === dest.id) throw new Error('Pick another account')
    copyChat(path, dest)
  },
  openInTerminal(accountId: string, sessionId: string, cwd: string) {
    const a = account(accountId)
    if (!SESSION_ID.test(sessionId)) throw new Error('Bad session id')
    const words = a.service === 'claude' ? ['claude', '--resume', sessionId] : ['codex', 'resume', sessionId]
    return store.runInTerminal(a, words, existsSync(cwd) ? cwd : undefined, shell.openPath)
  },
}
export type Api = typeof api

ipcMain.handle('call', async (_e, name: string, ...args: unknown[]) => {
  const fn = (api as Record<string, (...a: unknown[]) => unknown>)[name]
  if (!Object.hasOwn(api, name)) throw new Error(`Unknown call ${name}`)
  return fn(...args)
})

// ---- Lifecycle ----

app.on('second-instance', showWindow)
app.on('activate', showWindow)
app.on('before-quit', () => { quitting = true; stopAll() })
app.on('window-all-closed', () => {}) // keep running in the tray

app.whenReady().then(async () => {
  store.cleanRunDir()
  // First run: env.sh must exist before the shell hook reads it.
  if (process.platform !== 'win32' && !existsSync(join(store.ROOT, 'env.sh'))) await store.writeEnv(state)
  initHistory()
  const icon = nativeImage.createFromBuffer(Buffer.from(TRAY_PNG, 'base64'), { scaleFactor: 2 })
  if (process.platform === 'darwin') icon.setTemplateImage(true)
  tray = new Tray(icon)
  tray.setToolTip('switch-man')
  if (process.platform !== 'darwin') tray.on('click', showWindow)
  const hidden = process.argv.includes('--hidden') || app.getLoginItemSettings().wasOpenedAtLogin
  createWindow(!hidden)
  refresh()
  setInterval(refresh, 15_000)
})
