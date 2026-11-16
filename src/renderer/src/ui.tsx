import { useEffect, useId, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { Limit, Service } from '../../shared/types.ts'

export const SERVICE_LABEL: Record<Service, string> = { claude: 'Claude Code', codex: 'Codex' }
export const spring = { type: 'spring', stiffness: 380, damping: 32 } as const

/** Re-renders every `ms` so countdowns stay current. */
export function useNow(ms = 30_000) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t) }, [ms])
  return now
}

export function timeLeft(at: number, now: number) {
  const m = Math.max(0, Math.round((at - now) / 60_000))
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`
}

export function ago(t: number, now: number) {
  const m = Math.round((now - t) / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`
}

// Fill colours by how close the limit is: calm cyan, then amber, then hot pink-red.
const RING_STOPS = (p: number) => (p >= 85 ? ['#fb7185', '#ef4444'] : p >= 60 ? ['#fde047', '#fb923c'] : ['#22d3ee', '#a78bfa'])

export function Ring({ percent, size = 44 }: { percent: number; size?: number }) {
  const r = (size - 6) / 2, c = 2 * Math.PI * r, p = Math.min(100, Math.max(0, percent)), id = 'ring' + useId().replace(/[^a-zA-Z0-9]/g, '')
  const [a, b] = RING_STOPS(p)
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
      <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={a} /><stop offset="1" stopColor={b} /></linearGradient></defs>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="white" strokeOpacity={0.08} strokeWidth={4} />
      <motion.circle
        cx={size / 2} cy={size / 2} r={r} fill="none" stroke={`url(#${id})`} strokeWidth={4} strokeLinecap="round"
        style={{ filter: `drop-shadow(0 0 4px ${a}80)` }}
        strokeDasharray={c} initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - p / 100) }}
        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
      />
    </svg>
  )
}

export function LimitView({ label, limit, now, bell, onBell }: { label: string; limit?: Limit; now: number; bell: boolean; onBell: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-white/[0.03] px-3 py-2.5 ring-1 ring-white/5">
      <div className="relative">
        <Ring percent={limit?.percent ?? 0} />
        <span className="absolute inset-0 grid place-items-center text-[11px] font-semibold tabular-nums text-neutral-200">
          {limit ? `${Math.round(limit.percent)}%` : '–'}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-neutral-300">{label}</div>
        <div className="truncate text-[11px] text-neutral-500">
          {!limit ? 'No reading' : limit.resetsAt ? `Resets in ${timeLeft(limit.resetsAt, now)}` : 'Reset'}
        </div>
      </div>
      <button
        onClick={onBell} aria-pressed={bell} title={bell ? 'Alert on reset is on' : 'Alert me when this resets'}
        className={`grid size-7 place-items-center rounded-lg transition ${bell ? 'bg-brand-500/20 text-brand-300' : 'text-neutral-500 hover:bg-white/5 hover:text-neutral-300'}`}
      >
        <BellIcon on={bell} />
        <span className="sr-only">{bell ? `Turn off ${label} reset alert` : `Alert when ${label} limit resets`}</span>
      </button>
    </div>
  )
}

export function BellIcon({ on }: { on: boolean }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  )
}

export function Button({ children, kind = 'ghost', className = '', ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: 'primary' | 'ghost' | 'danger' }) {
  const k = {
    primary: 'bg-gradient-to-r from-brand-500 to-fuchsia-500 text-white shadow-[0_6px_20px_-8px_rgba(124,92,255,0.9)] hover:brightness-110 disabled:opacity-40 disabled:shadow-none',
    ghost: 'bg-white/5 text-neutral-200 hover:bg-white/10 disabled:text-neutral-500',
    danger: 'bg-red-500/15 text-red-300 hover:bg-red-500/25',
  }[kind]
  return <button {...p} className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition focus-visible:outline-2 focus-visible:outline-brand-400 disabled:cursor-not-allowed ${k} ${className}`}>{children}</button>
}

export function Modal({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!open) return
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [open, onClose])
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
          <motion.div
            role="dialog" aria-modal aria-label={title} onMouseDown={e => e.stopPropagation()}
            initial={{ opacity: 0, y: 16, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.98 }} transition={spring}
            className="w-full max-w-md rounded-2xl bg-[#12121f]/95 p-5 backdrop-blur-xl shadow-2xl ring-1 ring-white/10"
          >
            <h2 className="mb-4 text-sm font-semibold text-neutral-100">{title}</h2>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export const inputCls = 'w-full rounded-lg bg-black/40 px-3 py-2 text-sm text-neutral-100 ring-1 ring-white/10 placeholder:text-neutral-600 focus:outline-none focus:ring-brand-400/60'

export function Avatar({ name, service }: { name: string; service: Service }) {
  const tone = service === 'claude' ? 'from-orange-400/80 to-rose-500/80' : 'from-emerald-400/80 to-teal-600/80'
  return <div className={`grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br ${tone} text-sm font-semibold text-white`} aria-hidden>{name.slice(0, 1).toUpperCase()}</div>
}
