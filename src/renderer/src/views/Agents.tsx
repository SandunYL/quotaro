import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { AppState, Msg, Run, Session } from '../../../shared/types.ts'
import { call } from '../api.ts'
import type { Act } from '../main.tsx'
import { Button, Modal, SERVICE_LABEL, ago, inputCls, spring, useNow } from '../ui.tsx'

type Pick = { kind: 'session'; path: string } | { kind: 'run'; id: string } | null
const folderName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p

export default function Agents({ state, act }: { state: AppState; act: Act }) {
  const now = useNow(15_000)
  const [sessions, setSessions] = useState<Session[]>([])
  const [pick, setPick] = useState<Pick>(null)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [starting, setStarting] = useState(false)
  const accountName = (id: string) => state.accounts.find(a => a.id === id)?.name ?? id

  useEffect(() => {
    const load = () => call('sessions').then(setSessions).catch(() => {})
    load()
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [])

  const session = pick?.kind === 'session' ? sessions.find(s => s.path === pick.path) : undefined
  const run = pick?.kind === 'run' ? state.runs.find(r => r.id === pick.id) : undefined

  const live = session?.live
  useEffect(() => {
    if (pick?.kind !== 'session') return
    const load = () => call('messages', pick.path).then(setMsgs).catch(() => setMsgs([]))
    load()
    if (!live) return // a quiet chat doesn't change; only follow active ones
    const t = setInterval(load, 4000)
    return () => clearInterval(t)
  }, [pick, live])

  const send = (text: string) => {
    const target = run ?? session
    if (!target) return
    const accountId = target.accountId, cwd = target.cwd, sid = run ? run.sessionId : session!.id
    return act(async () => { const id = await call('send', accountId, cwd, text, sid); setPick({ kind: 'run', id }) })
  }

  const runs = [...state.runs].reverse()
  return (
    <div className="flex h-full">
      <aside className="flex w-80 shrink-0 flex-col border-r border-white/5" aria-label="Chats and agents">
        <header className="flex items-center justify-between px-4 pb-3 pt-12">
          <h1 className="text-lg font-semibold text-neutral-50">Agents</h1>
          <Button kind="primary" onClick={() => setStarting(true)}>+ New agent</Button>
        </header>
        <div className="flex-1 overflow-y-auto px-2 pb-4">
          {runs.length > 0 && <ListLabel>Started here</ListLabel>}
          <AnimatePresence initial={false}>
            {runs.map(r => (
              <Row key={r.id} selected={pick?.kind === 'run' && pick.id === r.id} onClick={() => setPick({ kind: 'run', id: r.id })}
                title={r.prompt} live={r.status === 'running'} meta={`${accountName(r.accountId)} · ${folderName(r.cwd)} · ${r.status}`} error={r.status === 'error'} />
            ))}
          </AnimatePresence>
          <ListLabel>Last 7 days</ListLabel>
          {sessions.length === 0 && <p className="px-3 text-xs text-neutral-600">No Claude Code or Codex chats this week.</p>}
          {sessions.map(s => (
            <Row key={s.path} selected={pick?.kind === 'session' && pick.path === s.path} onClick={() => setPick({ kind: 'session', path: s.path })}
              title={s.title} live={s.live} meta={`${SERVICE_LABEL[s.service]} · ${accountName(s.accountId)} · ${folderName(s.cwd)} · ${ago(s.mtime, now)}`} />
          ))}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col" aria-label="Conversation">
        {!run && !session ? (
          <div className="grid flex-1 place-items-center p-8 text-center">
            <div>
              <p className="text-sm text-neutral-300">Pick a chat to read it and send it a message.</p>
              <p className="mt-1 text-xs text-neutral-600">A message to a chat open in a terminal continues it as a background run.</p>
            </div>
          </div>
        ) : (
          <Thread
            key={pick?.kind === 'run' ? pick.id : pick?.path}
            title={run ? run.prompt : session!.title}
            sub={`${accountName((run ?? session)!.accountId)} · ${(run ?? session)!.cwd}`}
            msgs={run ? run.output : msgs}
            run={run}
            onSend={send}
            actions={<Actions state={state} act={act} session={session} run={run} onOpenSession={p => setPick({ kind: 'session', path: p })} sessions={sessions} />}
          />
        )}
      </section>

      <NewAgent open={starting} onClose={() => setStarting(false)} state={state} act={act} onStarted={id => setPick({ kind: 'run', id })} />
    </div>
  )
}

const ListLabel = ({ children }: { children: string }) => <h2 className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-neutral-600">{children}</h2>

function Row({ title, meta, live, selected, error, onClick }: { title: string; meta: string; live: boolean; selected: boolean; error?: boolean; onClick: () => void }) {
  return (
    <motion.button
      layout initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={spring} onClick={onClick} aria-current={selected || undefined}
      className={`mb-0.5 flex w-full items-start gap-2.5 rounded-xl px-3 py-2 text-left transition ${selected ? 'bg-white/[0.07]' : 'hover:bg-white/[0.04]'}`}
    >
      <span className="relative mt-1.5 flex size-2 shrink-0" title={live ? 'Active now' : undefined}>
        {live && <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />}
        <span className={`relative inline-flex size-2 rounded-full ${live ? 'bg-emerald-400' : error ? 'bg-red-400' : 'bg-neutral-700'}`} />
      </span>
      <span className="min-w-0">
        <span className="line-clamp-1 text-sm text-neutral-200">{title}</span>
        <span className="line-clamp-1 text-[11px] text-neutral-500">{live ? 'Active · ' : ''}{meta}</span>
      </span>
    </motion.button>
  )
}

function Thread({ title, sub, msgs, run, onSend, actions }: { title: string; sub: string; msgs: Msg[]; run?: Run; onSend: (t: string) => unknown; actions: React.ReactNode }) {
  const [text, setText] = useState('')
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs.length])
  const busy = run?.status === 'running'
  const submit = () => { if (text.trim() && !busy) { onSend(text.trim()); setText('') } }
  return (
    <>
      <header className="border-b border-white/5 px-6 pb-3 pt-12">
        <h2 className="line-clamp-1 text-base font-semibold text-neutral-50">{title}</h2>
        <p className="line-clamp-1 text-xs text-neutral-500">{sub}</p>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">{actions}</div>
      </header>
      <div className="flex-1 space-y-3 overflow-y-auto px-6 py-5" aria-live="polite">
        {msgs.length === 0 && !busy && <p className="text-xs text-neutral-600">No messages to show.</p>}
        {msgs.map((m, i) => (
          <motion.div key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}
            className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${m.role === 'user' ? 'ml-auto bg-violet-500/15 text-violet-100' : 'bg-white/[0.04] text-neutral-200'}`}>
            {m.text}
          </motion.div>
        ))}
        {busy && <div className="flex gap-1 px-2" aria-label="Working"><Dot d={0} /><Dot d={0.15} /><Dot d={0.3} /></div>}
        {run?.status === 'error' && <p className="rounded-xl bg-red-500/10 px-4 py-2.5 text-sm text-red-300">{run.error ?? 'The run failed.'}</p>}
        <div ref={end} />
      </div>
      <form onSubmit={e => { e.preventDefault(); submit() }} className="border-t border-white/5 p-4">
        <div className="flex items-end gap-2 rounded-2xl bg-white/[0.03] p-2 ring-1 ring-white/10 focus-within:ring-violet-400/50">
          <textarea
            value={text} onChange={e => setText(e.target.value)} rows={2} aria-label="Message"
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit() } }}
            placeholder={busy ? 'Working…' : 'Message this agent (⌘/Ctrl + Enter)'}
            className="flex-1 resize-none bg-transparent px-2 py-1 text-sm text-neutral-100 placeholder:text-neutral-600 focus:outline-none"
          />
          <Button kind="primary" type="submit" disabled={busy || !text.trim()}>Send</Button>
        </div>
      </form>
    </>
  )
}

const Dot = ({ d }: { d: number }) => (
  <motion.span className="size-1.5 rounded-full bg-neutral-500" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1, repeat: Infinity, delay: d }} />
)

function Actions({ state, act, session, run, sessions, onOpenSession }: { state: AppState; act: Act; session?: Session; run?: Run; sessions: Session[]; onOpenSession: (p: string) => void }) {
  const [dest, setDest] = useState('')
  const sid = session?.id ?? run?.sessionId
  const target = session ?? run
  const linked = run && sessions.find(s => s.id === run.sessionId)
  const others = state.accounts.filter(a => a.service === 'claude' && a.exists && a.id !== session?.accountId)
  return (
    <>
      {run?.status === 'running' && <Button kind="danger" onClick={() => act(() => call('stop', run.id))}>Stop</Button>}
      {run && run.status !== 'running' && <Button onClick={() => act(() => call('dismissRun', run.id))}>Dismiss</Button>}
      {linked && <Button onClick={() => onOpenSession(linked.path)}>Open full chat</Button>}
      {sid && target && <Button onClick={() => act(() => call('openInTerminal', target.accountId, sid, target.cwd))}>Open in terminal</Button>}
      {session?.service === 'claude' && others.length > 0 && (
        <span className="ml-auto flex items-center gap-1.5">
          <select value={dest} onChange={e => setDest(e.target.value)} aria-label="Copy to account" className="rounded-lg bg-white/5 px-2 py-1.5 text-xs text-neutral-200 ring-1 ring-white/10">
            <option value="">Copy to account…</option>
            {others.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <Button disabled={!dest} onClick={() => act(() => call('copyChat', session.path, dest), 'Copied. Resume it from that account.')}>Copy</Button>
        </span>
      )}
    </>
  )
}

function NewAgent({ open, onClose, state, act, onStarted }: { open: boolean; onClose: () => void; state: AppState; act: Act; onStarted: (id: string) => void }) {
  const accounts = state.accounts.filter(a => a.exists)
  const [accountId, setAccountId] = useState('')
  const [cwd, setCwd] = useState('')
  const [prompt, setPrompt] = useState('')
  const chosen = accountId || accounts.find(a => a.active)?.id || accounts[0]?.id || ''
  const start = () => act(async () => {
    const id = await call('send', chosen, cwd, prompt)
    onClose(); setPrompt(''); onStarted(id)
  })
  return (
    <Modal open={open} title="New agent" onClose={onClose}>
      <form onSubmit={e => { e.preventDefault(); start() }} className="space-y-4">
        <label className="block text-xs text-neutral-400">
          Account
          <select value={chosen} onChange={e => setAccountId(e.target.value)} className={`${inputCls} mt-1.5`}>
            {accounts.map(a => <option key={a.id} value={a.id}>{SERVICE_LABEL[a.service]} · {a.name}</option>)}
          </select>
        </label>
        <div className="text-xs text-neutral-400">
          Folder
          <div className="mt-1.5 flex gap-2">
            <div className={`${inputCls} truncate ${cwd ? '' : 'text-neutral-600'}`}>{cwd || 'Pick the project folder'}</div>
            <Button type="button" onClick={() => act(async () => { const p = await call('pickFolder'); if (p) setCwd(p) })}>Choose…</Button>
          </div>
        </div>
        <label className="block text-xs text-neutral-400">
          Task
          <textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={4} placeholder="What should the agent do?" className={`${inputCls} mt-1.5 resize-none`} />
        </label>
        <p className="text-xs text-neutral-500">Runs in the background with that account's own permission settings.</p>
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button kind="primary" type="submit" disabled={!chosen || !cwd || !prompt.trim()}>Start</Button>
        </div>
      </form>
    </Modal>
  )
}
