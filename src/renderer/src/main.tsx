import { StrictMode, useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AnimatePresence, motion } from 'motion/react'
import type { AppState } from '../../shared/types.ts'
import { call, onRun, onState } from './api.ts'
import { spring } from './ui.tsx'
import Overview from './views/Overview.tsx'
import Agents from './views/Agents.tsx'
import Stats from './views/Stats.tsx'
import Settings from './views/Settings.tsx'
import './index.css'

const VIEWS = ['Overview', 'Agents', 'Stats', 'Settings'] as const
type View = (typeof VIEWS)[number]

export type Act = (fn: () => Promise<unknown>, ok?: string) => Promise<void>

function App() {
  const [state, setState] = useState<AppState | null>(null)
  const [view, setView] = useState<View>('Overview')
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null)

  useEffect(() => {
    call('state').then(setState)
    const offS = onState(setState)
    const offR = onRun(r => setState(s => s && { ...s, runs: [...s.runs.filter(x => x.id !== r.id), r] }))
    return () => { offS(); offR() }
  }, [])

  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(null), 3200); return () => clearTimeout(t) } }, [toast])

  // Every user action goes through here, so failures always reach the screen.
  const act: Act = useCallback(async (fn, ok) => {
    try { await fn(); if (ok) setToast({ text: ok }) } catch (e: any) { setToast({ text: e.message, error: true }) }
  }, [])

  if (!state) return <div className="h-screen bg-[#0a0a0b]" />
  const running = state.runs.filter(r => r.status === 'running').length

  return (
    <div className="flex h-screen bg-[#0a0a0b] text-neutral-200 antialiased">
      <nav className="flex w-52 shrink-0 flex-col border-r border-white/5 bg-black/30 px-3 pb-4 pt-12" aria-label="Main">
        <div className="mb-6 flex items-center gap-2 px-2">
          <div className="grid size-7 place-items-center rounded-lg bg-violet-500 text-xs font-bold text-white">sm</div>
          <span className="text-sm font-semibold tracking-tight text-neutral-100">switch-man</span>
        </div>
        {VIEWS.map(v => (
          <button
            key={v} onClick={() => setView(v)} aria-current={view === v ? 'page' : undefined}
            className="relative mb-0.5 flex items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-neutral-400 transition hover:text-neutral-100 aria-[current=page]:text-neutral-100"
          >
            {view === v && <motion.span layoutId="nav" className="absolute inset-0 rounded-lg bg-white/[0.07]" transition={spring} />}
            <span className="relative">{v}</span>
            {v === 'Agents' && running > 0 && <span className="relative rounded-full bg-violet-500/20 px-1.5 text-[10px] font-semibold text-violet-300">{running}</span>}
          </button>
        ))}
        <div className="mt-auto px-2 text-[11px] leading-relaxed text-neutral-600">Local only. Login tokens are never read.</div>
      </nav>

      <main className="relative min-w-0 flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div key={view} className="h-full" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
            {view === 'Overview' && <Overview state={state} act={act} />}
            {view === 'Agents' && <Agents state={state} act={act} />}
            {view === 'Stats' && <Stats state={state} />}
            {view === 'Settings' && <Settings state={state} act={act} />}
          </motion.div>
        </AnimatePresence>

        <div className="pointer-events-none absolute inset-x-0 bottom-5 flex justify-center" role="status" aria-live="polite">
          <AnimatePresence>
            {toast && (
              <motion.div
                initial={{ opacity: 0, y: 12, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }} transition={spring}
                className={`max-w-md rounded-xl px-4 py-2.5 text-sm shadow-xl ring-1 ${toast.error ? 'bg-red-950 text-red-200 ring-red-500/30' : 'bg-neutral-800 text-neutral-100 ring-white/10'}`}
              >{toast.text}</motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
