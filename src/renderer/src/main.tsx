import { StrictMode, useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { AppState } from '../../shared/types.ts'
import { call, onRun, onState } from './api.ts'
import { spring } from './ui.tsx'
import Overview from './views/Overview.tsx'
import Agents from './views/Agents.tsx'
import Stats from './views/Stats.tsx'
import Settings from './views/Settings.tsx'
import logo from '../../../build/icon.svg'
import './index.css'

const VIEWS = ['Overview', 'Agents', 'Stats', 'Settings'] as const
type View = (typeof VIEWS)[number]

export type Act = (fn: () => Promise<unknown>, ok?: string) => Promise<void>

function App() {
  const [state, setState] = useState<AppState | null>(null)
  const [view, setView] = useState<View>('Overview')
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null)
  const still = useReducedMotion()

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

  if (!state) return <div className="h-screen aurora" />
  const running = state.runs.filter(r => r.status === 'running').length

  return (
    <div className="flex h-screen aurora text-neutral-200 antialiased">
      <nav className="flex w-52 shrink-0 flex-col border-r border-white/5 bg-white/[0.02] backdrop-blur-xl px-3 pb-4 pt-12" aria-label="Main">
        <div className="mb-6 flex items-center gap-2 px-2">
          {/* A little dance that never stops; held still for people who ask their OS for less motion. */}
          <motion.img
            src={logo} alt="" className="size-8 scale-125"
            animate={still ? undefined : { rotate: [0, -10, 8, -6, 0], y: [0, -4, 0, -2, 0], scale: [1.25, 1.35, 1.25, 1.3, 1.25] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
          />
          <span className="text-sm font-semibold tracking-tight text-neutral-100">Quotaro</span>
        </div>
        {VIEWS.map(v => (
          <button
            key={v} onClick={() => setView(v)} aria-current={view === v ? 'page' : undefined}
            className="relative mb-0.5 flex items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-neutral-400 transition hover:text-neutral-100 aria-[current=page]:text-neutral-100"
          >
            {view === v && <motion.span layoutId="nav" className="absolute inset-0 rounded-lg bg-gradient-to-r from-brand-500/25 to-cyan-400/5 ring-1 ring-white/10" transition={spring} />}
            <span className="relative">{v}</span>
            {v === 'Agents' && running > 0 && <span className="relative rounded-full bg-brand-500/20 px-1.5 text-[10px] font-semibold text-brand-300">{running}</span>}
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
