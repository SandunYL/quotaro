import type { ReactNode } from 'react'
import type { AppState } from '../../../shared/types.ts'
import { call } from '../api.ts'
import type { Act } from '../main.tsx'
import { Button } from '../ui.tsx'

export default function Settings({ state, act }: { state: AppState; act: Act }) {
  const untracked = state.accounts.filter(a => a.service === 'claude' && a.exists && !a.tracking)
  return (
    <div className="h-full overflow-y-auto px-8 pb-16 pt-12">
      <h1 className="text-2xl font-semibold tracking-tight text-neutral-50">Settings</h1>
      <div className="mt-6 max-w-2xl divide-y divide-white/5 rounded-2xl glass ring-1 ring-white/5">
        {state.loginItem !== null && (
          <Item title="Open at login" text="Starts hidden in the tray so reset alerts keep working.">
            <button role="switch" aria-checked={state.loginItem} aria-label="Open at login" onClick={() => act(() => call('setLoginItem', !state.loginItem))}
              className={`relative h-6 w-10 rounded-full transition ${state.loginItem ? 'bg-gradient-to-r from-brand-500 to-fuchsia-500' : 'bg-white/10'}`}>
              <span className={`absolute top-1 size-4 rounded-full bg-white transition-all ${state.loginItem ? 'left-5' : 'left-1'}`} />
            </button>
          </Item>
        )}
        <Item title="Terminal" text={state.platform === 'win32'
          ? 'Switching sets your user environment variables. New terminals pick it up.'
          : state.shellLinked ? 'Connected. New prompts use the active accounts.' : 'Not connected yet, so a switch does not reach your terminals.'}>
          {!state.shellLinked && <Button kind="primary" onClick={() => act(() => call('linkShell'), 'Connected. Open a new terminal window once.')}>Connect</Button>}
        </Item>
        <Item title="Claude Code usage tracking" text={untracked.length
          ? `Off for ${untracked.map(a => a.name).join(', ')}. Quotaro reads limits from Claude Code's status line; your own status line keeps working.`
          : 'On for every Claude Code account.'}>
          {untracked.length > 0 && <Button onClick={() => act(async () => { for (const a of untracked) await call('enableTracking', a.id) }, 'Tracking on')}>Turn on all</Button>}
        </Item>
        <Item title="Data folder" text="Accounts, history and the shell hook live in ~/.switch-man.">
          <Button onClick={() => act(() => call('revealData'))}>Open</Button>
        </Item>
      </div>
      <p className="mt-6 max-w-2xl text-xs leading-relaxed text-neutral-600">
        Quotaro works from files on this computer. It never reads or sends login tokens. Codex emails come from the local sign-in file and stay on this machine.
      </p>
    </div>
  )
}

function Item({ title, text, children }: { title: string; text: string; children?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 px-5 py-4">
      <div>
        <div className="text-sm font-medium text-neutral-100">{title}</div>
        <div className="mt-0.5 text-xs text-neutral-500">{text}</div>
      </div>
      {children}
    </div>
  )
}
