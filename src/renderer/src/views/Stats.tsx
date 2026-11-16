import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import type { AppState, Sample, WindowKind } from '../../../shared/types.ts'
import { call } from '../api.ts'
import { SERVICE_LABEL } from '../ui.tsx'

const RANGES = [{ label: '24h', ms: 24 * 3600_000 }, { label: '7 days', ms: 7 * 24 * 3600_000 }, { label: '30 days', ms: 30 * 24 * 3600_000 }]
// Categorical slots 1 and 2 of the dark reference palette.
const SERIES: { k: WindowKind; name: string; color: string }[] = [
  { k: '5h', name: '5-hour', color: '#3987e5' },
  { k: 'week', name: 'Weekly', color: '#d95926' },
]
const H = 280, PAD = { l: 40, r: 64, t: 12, b: 28 }

/** The value in force at time t: the last sample at or before it. */
export function valueAt(points: Sample[], t: number): number | undefined {
  let v: number | undefined
  for (const p of points) { if (p.t > t) break; v = p.p }
  return v
}

export default function Stats({ state }: { state: AppState }) {
  const [samples, setSamples] = useState<Sample[]>([])
  const accounts = state.accounts.filter(a => a.exists || !a.isDefault)
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '')
  const [range, setRange] = useState(RANGES[1])
  const [hover, setHover] = useState<number | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(700)

  useEffect(() => { call('history').then(setSamples) }, [state.accounts])
  useLayoutEffect(() => {
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width))
    if (box.current) ro.observe(box.current)
    return () => ro.disconnect()
  }, [])

  const end = Date.now(), start = end - range.ms
  const series = useMemo(() => SERIES.map(s => {
    const all = samples.filter(x => x.a === accountId && x.k === s.k)
    // Carry the last value from before the range in, so the line starts at the left edge.
    const before = all.filter(x => x.t < start).at(-1)
    const inRange = all.filter(x => x.t >= start)
    return { ...s, points: [...(before ? [{ ...before, t: start }] : []), ...inRange] }
  }).filter(s => s.points.length), [samples, accountId, start])

  const x = (t: number) => PAD.l + ((t - start) / (end - start)) * (w - PAD.l - PAD.r)
  const y = (p: number) => PAD.t + (1 - Math.min(100, p) / 100) * (H - PAD.t - PAD.b)
  // Usage holds its value until the next reading, so the line steps rather than slopes.
  const path = (pts: Sample[]) => pts.map((p, i) => (i ? `H${x(p.t)}V${y(p.p)}` : `M${x(p.t)},${y(p.p)}`)).join('') + `H${x(end)}`
  const ticks = Array.from({ length: 5 }, (_, i) => start + (i * (end - start)) / 4)
  const fmt = (t: number) => range.ms <= RANGES[0].ms
    ? new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' })
  const hoverT = hover === null ? null : start + ((hover - PAD.l) / (w - PAD.l - PAD.r)) * (end - start)

  return (
    <div className="h-full overflow-y-auto px-8 pb-16 pt-12">
      <h1 className="text-2xl font-semibold tracking-tight text-neutral-50">Stats</h1>
      <p className="mt-1 text-sm text-neutral-500">Limit used over time. A reading is saved whenever a number changes.</p>

      <div className="mt-6 flex flex-wrap items-center gap-2" role="toolbar" aria-label="Filters">
        {accounts.map(a => (
          <button key={a.id} onClick={() => setAccountId(a.id)} aria-pressed={a.id === accountId}
            className="rounded-full px-3 py-1 text-xs text-neutral-400 ring-1 ring-white/10 transition hover:text-neutral-100 aria-pressed:bg-white/10 aria-pressed:text-neutral-100">
            {SERVICE_LABEL[a.service]} · {a.name}
          </button>
        ))}
        <span className="ml-auto flex rounded-full p-0.5 ring-1 ring-white/10">
          {RANGES.map(r => (
            <button key={r.label} onClick={() => setRange(r)} aria-pressed={r === range}
              className="rounded-full px-3 py-1 text-xs text-neutral-400 transition aria-pressed:bg-white/10 aria-pressed:text-neutral-100">{r.label}</button>
          ))}
        </span>
      </div>

      <motion.figure layout className="mt-6 rounded-2xl glass p-5 ring-1 ring-white/5">
        <figcaption className="mb-3 flex items-center gap-4 text-xs text-neutral-400">
          {SERIES.map(s => <span key={s.k} className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded" style={{ background: s.color }} />{s.name}</span>)}
        </figcaption>
        <div ref={box} className="relative">
          {series.length === 0 ? (
            <div className="grid h-[280px] place-items-center text-sm text-neutral-600">No readings in this range yet.</div>
          ) : (
            <svg width={w} height={H} role="img" aria-label={`Usage over the last ${range.label}`}
              onMouseMove={e => setHover(Math.max(PAD.l, Math.min(w - PAD.r, e.nativeEvent.offsetX)))} onMouseLeave={() => setHover(null)}>
              {[0, 25, 50, 75, 100].map(p => (
                <g key={p}>
                  <line x1={PAD.l} x2={w - PAD.r} y1={y(p)} y2={y(p)} stroke="white" strokeOpacity={p ? 0.05 : 0.15} />
                  <text x={PAD.l - 8} y={y(p)} dy="0.32em" textAnchor="end" className="fill-neutral-500 text-[10px]">{p}%</text>
                </g>
              ))}
              {ticks.map(t => <text key={t} x={x(t)} y={H - 8} textAnchor="middle" className="fill-neutral-500 text-[10px]">{fmt(t)}</text>)}
              {series.map(s => {
                const last = s.points.at(-1)!
                return (
                  <g key={s.k}>
                    <motion.path d={path(s.points)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round"
                      initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.8, ease: 'easeOut' }} />
                    {s.points.length <= 60 && s.points.map(p => <circle key={p.t} cx={x(p.t)} cy={y(p.p)} r={4} fill={s.color} stroke="#171717" strokeWidth={2} />)}
                    <text x={w - PAD.r + 6} y={y(last.p)} dy="0.32em" className="fill-neutral-300 text-[10px]">{s.name} {Math.round(last.p)}%</text>
                  </g>
                )
              })}
              {hoverT !== null && hover !== null && (
                <g pointerEvents="none">
                  <line x1={hover} x2={hover} y1={PAD.t} y2={H - PAD.b} stroke="white" strokeOpacity={0.25} />
                  {series.map(s => { const v = valueAt(s.points, hoverT); return v === undefined ? null : <circle key={s.k} cx={hover} cy={y(v)} r={4} fill={s.color} stroke="#171717" strokeWidth={2} /> })}
                </g>
              )}
            </svg>
          )}
          {hoverT !== null && hover !== null && series.length > 0 && (
            <div className="pointer-events-none absolute top-2 rounded-lg bg-neutral-800 px-3 py-2 text-xs shadow-xl ring-1 ring-white/10"
              style={{ left: Math.min(hover + 12, w - 150) }}>
              <div className="mb-1 text-neutral-400">{new Date(hoverT).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
              {series.map(s => { const v = valueAt(s.points, hoverT); return (
                <div key={s.k} className="flex items-center gap-2 text-neutral-100"><span className="size-2 rounded-full" style={{ background: s.color }} />{s.name}<span className="ml-auto pl-3 tabular-nums">{v === undefined ? '–' : `${Math.round(v)}%`}</span></div>
              ) })}
            </div>
          )}
        </div>
        <table className="sr-only">
          <caption>Readings for the selected account</caption>
          <thead><tr><th>Time</th><th>Limit</th><th>Used</th></tr></thead>
          <tbody>{series.flatMap(s => s.points.map(p => <tr key={`${s.k}${p.t}`}><td>{new Date(p.t).toLocaleString()}</td><td>{s.name}</td><td>{Math.round(p.p)}%</td></tr>))}</tbody>
        </table>
      </motion.figure>
    </div>
  )
}
