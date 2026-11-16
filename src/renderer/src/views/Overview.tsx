import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { AccountView, AppState, Service } from '../../../shared/types.ts'
import { call } from '../api.ts'
import type { Act } from '../main.tsx'
import { Avatar, Button, EmojiPicker, LimitView, Modal, SERVICE_LABEL, inUse, inputCls, spring, timeLeft, useNow } from '../ui.tsx'

export default function Overview({ state, act }: { state: AppState; act: Act }) {
  const now = useNow()
  const [adding, setAdding] = useState(false)
  const [renaming, setRenaming] = useState<AccountView | null>(null)
  const [removing, setRemoving] = useState<AccountView | null>(null)

  const shown = state.accounts.filter(inUse)
  const byService = (s: Service) => shown.filter(a => a.service === s)
  // A provider gets its own switcher section only once it has more than one account.
  const multi = (['claude', 'codex'] as Service[]).filter(s => byService(s).length > 1)
  const single = shown.filter(a => !multi.includes(a.service))
  const hour = new Date(now).getHours()
  const hello = hour < 5 ? 'Working late' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const running = state.runs.filter(r => r.status === 'running').length

  const card = (a: AccountView, canSwitch: boolean, i: number) => (
    <motion.article
      key={a.id} layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }}
      transition={{ ...spring, delay: i * 0.04 }}
      className={`rounded-2xl glass p-4 ring-1 transition ${a.active && canSwitch ? 'ring-brand-400/50 shadow-[0_0_48px_-16px_rgba(124,92,255,0.8)]' : 'ring-white/5'}`}
    >
      <header className="mb-3 flex items-center gap-3">
        <Avatar name={a.name} service={a.service} emoji={a.emoji} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-neutral-100">{a.name}</h3>
            {!canSwitch && <span className="text-[11px] text-neutral-500">{SERVICE_LABEL[a.service]}</span>}
            {a.active && canSwitch && <span className="rounded-full bg-brand-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-300">Active</span>}
          </div>
          <p className="truncate text-xs text-neutral-500">{a.email ?? (a.exists ? 'Not signed in' : 'Folder missing')}</p>
        </div>
        {canSwitch && !a.active && <Button kind="primary" onClick={() => act(() => call('select', a.id), `New ${SERVICE_LABEL[a.service]} sessions use ${a.name}`)}>Switch</Button>}
      </header>

      <div className="grid grid-cols-2 gap-2">
        {(['5h', 'week'] as const).map(k => {
          const key = `${a.id}:${k}`
          return (
            <LimitView
              key={k} label={k === '5h' ? '5-hour' : 'Weekly'} limit={k === '5h' ? a.usage?.five : a.usage?.week} now={now}
              bell={!!state.bells[key]} onBell={() => act(() => call('setBell', key, !state.bells[key]), state.bells[key] ? undefined : 'You will be notified when it resets')}
            />
          )
        })}
      </div>

      {a.service === 'claude' && a.exists && <AutoStart a={a} state={state} act={act} now={now} />}

      {a.service === 'claude' && a.exists && !a.tracking && (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          <span>Usage tracking is off for this account.</span>
          <Button onClick={() => act(() => call('enableTracking', a.id), 'Tracking on. Numbers appear after the next reply.')}>Turn on</Button>
        </div>
      )}
      {a.usage && <p className="mt-2 text-[11px] text-neutral-600">Reading from {new Date(a.usage.asOf).toLocaleString()}</p>}

      <footer className="mt-3 flex flex-wrap gap-1.5">
        <Button onClick={() => act(() => call('signIn', a.id))}>{a.email ? 'Sign in again' : 'Sign in'}</Button>
        <Button onClick={() => act(() => call('reveal', a.id))}>Show folder</Button>
        <Button onClick={() => setRenaming(a)}>Edit</Button>
        {!a.isDefault && <Button kind="danger" onClick={() => setRemoving(a)}>Remove</Button>}
      </footer>
    </motion.article>
  )

  return (
    <div className="h-full overflow-y-auto px-8 pb-16 pt-12">
      <header className="mb-8 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-50">{hello}</h1>
          <p className="mt-1 text-sm text-neutral-500">
            {shown.length} account{shown.length === 1 ? '' : 's'}{running ? ` · ${running} agent${running === 1 ? '' : 's'} running` : ''}
          </p>
        </div>
        <Button kind="primary" onClick={() => setAdding(true)}>+ Add account</Button>
      </header>

      {!state.shellLinked && (
        <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="mb-6 flex items-center justify-between gap-4 rounded-2xl bg-brand-500/10 px-4 py-3 ring-1 ring-brand-500/20">
          <div>
            <p className="text-sm font-medium text-brand-200">Connect your terminal</p>
            <p className="text-xs text-brand-300/70">Adds a small hook to your shell so a switch applies at the next prompt.</p>
          </div>
          <Button kind="primary" onClick={() => act(() => call('linkShell'), 'Connected. Open a new terminal window once.')}>Connect</Button>
        </motion.div>
      )}

      {multi.map(s => (
        <section key={s} className="mb-8" aria-label={SERVICE_LABEL[s]}>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">{SERVICE_LABEL[s]}</h2>
          <div className="grid gap-3 xl:grid-cols-2"><AnimatePresence>{byService(s).map((a, i) => card(a, true, i))}</AnimatePresence></div>
        </section>
      ))}
      {single.length > 0 && (
        <section aria-label="Usage">
          {multi.length > 0 && <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">Other apps</h2>}
          <div className="grid gap-3 xl:grid-cols-2"><AnimatePresence>{single.map((a, i) => card(a, false, i))}</AnimatePresence></div>
        </section>
      )}
      {shown.length === 0 && <p className="text-sm text-neutral-500">No Claude Code or Codex logins found yet. Add an account to start.</p>}

      <AddAccount open={adding} onClose={() => setAdding(false)} act={act} />
      <EditAccount key={renaming?.id} account={renaming} onClose={() => setRenaming(null)} act={act} />
      <Modal open={!!removing} title={`Remove ${removing?.name}?`} onClose={() => setRemoving(null)}>
        <p className="mb-4 text-sm text-neutral-400">Its folder moves to the Trash, so you can restore it. Imported AccountDeck folders are left in place.</p>
        <div className="flex justify-end gap-2">
          <Button onClick={() => setRemoving(null)}>Cancel</Button>
          <Button kind="danger" onClick={() => { const a = removing!; setRemoving(null); act(() => call('remove', a.id), `${a.name} removed`) }}>Remove</Button>
        </div>
      </Modal>
    </div>
  )
}

function AddAccount({ open, onClose, act }: { open: boolean; onClose: () => void; act: Act }) {
  const [service, setService] = useState<Service>('claude')
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState<string>()
  const submit = () => { onClose(); act(() => call('addAccount', service, name, emoji), 'Finish signing in in the terminal window'); setName(''); setEmoji(undefined) }
  return (
    <Modal open={open} title="Add account" onClose={onClose}>
      <form onSubmit={e => { e.preventDefault(); submit() }} className="space-y-4">
        <fieldset className="grid grid-cols-2 gap-2">
          <legend className="mb-2 text-xs text-neutral-400">App</legend>
          {(['claude', 'codex'] as Service[]).map(s => (
            <label key={s} className={`cursor-pointer rounded-xl px-3 py-2.5 text-sm ring-1 transition ${service === s ? 'bg-brand-500/15 text-brand-200 ring-brand-500/40' : 'text-neutral-400 ring-white/10 hover:bg-white/5'}`}>
              <input type="radio" name="service" className="sr-only" checked={service === s} onChange={() => setService(s)} />
              {SERVICE_LABEL[s]}
            </label>
          ))}
        </fieldset>
        <label className="block text-xs text-neutral-400">
          Name
          <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Work, Personal…" maxLength={40} className={`${inputCls} mt-1.5`} />
        </label>
        <EmojiPicker value={emoji} onChange={setEmoji} />
        <p className="text-xs text-neutral-500">A terminal opens so you can sign in. The account gets its own folder; your Main login is untouched.</p>
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button kind="primary" type="submit" disabled={!name.trim()}>Add and sign in</Button>
        </div>
      </form>
    </Modal>
  )
}

function EditAccount({ account, onClose, act }: { account: AccountView | null; onClose: () => void; act: Act }) {
  const [name, setName] = useState(account?.name ?? '')
  const [emoji, setEmoji] = useState(account?.emoji)
  return (
    <Modal open={!!account} title="Edit account" onClose={onClose}>
      <form onSubmit={e => { e.preventDefault(); onClose(); act(() => call('edit', account!.id, name, emoji ?? null)) }} className="space-y-4">
        <label className="block text-xs text-neutral-400">
          Name
          <input autoFocus value={name} onChange={e => setName(e.target.value)} maxLength={40} className={`${inputCls} mt-1.5`} />
        </label>
        <EmojiPicker value={emoji} onChange={setEmoji} />
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button kind="primary" type="submit" disabled={!name.trim()}>Save</Button>
        </div>
      </form>
    </Modal>
  )
}

/** Sends a message right after each 5-hour reset, so the next window starts as early as possible. */
function AutoStart({ a, state, act, now }: { a: AccountView; state: AppState; act: Act; now: number }) {
  const message = state.autoStart[a.id], on = message !== undefined, next = state.nextAuto[a.id]
  const shared = !on ? undefined : state.accounts.find(o => o.id !== a.id && o.accountUuid && o.accountUuid === a.accountUuid && state.autoStart[o.id] !== undefined && state.nextAuto[o.id])
  return (
    <div className="mt-2 rounded-xl bg-white/[0.03] px-3 py-2.5 ring-1 ring-white/5">
      <div className="flex items-center gap-3">
        <button role="switch" aria-checked={on} aria-label="Auto-start a session at each reset"
          onClick={() => act(() => call('setAutoStart', a.id, on ? null : 'hi'), on ? undefined : 'A message goes out a minute after each 5-hour reset')}
          className={`relative h-5 w-9 shrink-0 rounded-full transition ${on ? 'bg-gradient-to-r from-brand-500 to-fuchsia-500' : 'bg-white/10'}`}>
          <span className={`absolute top-0.5 size-4 rounded-full bg-white transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-neutral-300">Auto-start at reset</div>
          <div className="truncate text-[11px] text-neutral-500">
            {!on ? 'Sends a message a minute after each 5-hour reset'
              : shared ? `Handled by ${shared.name}: same Claude account`
              : next ? `Next message ${next - now < 60_000 ? 'in under a minute' : `in ${timeLeft(next, now)}`}` : 'Scheduling…'}
          </div>
        </div>
      </div>
      {on && (
        <input
          key={message} defaultValue={message} maxLength={500} aria-label="Message to send at reset"
          onBlur={e => e.target.value.trim() !== message && act(() => call('setAutoStart', a.id, e.target.value), 'Message saved')}
          onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()}
          className={`${inputCls} mt-2 py-1.5 text-xs`}
        />
      )}
    </div>
  )
}
