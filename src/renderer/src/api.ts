import type { Api } from '../../main/index.ts'
import type { AppState, Run } from '../../shared/types.ts'

declare global {
  interface Window {
    switchman: {
      call: (name: string, ...args: unknown[]) => Promise<unknown>
      on: (channel: 'state' | 'run', cb: (data: any) => void) => () => void
    }
  }
}

/** Typed call into the main process. Errors arrive without Electron's "Error invoking remote method" prefix. */
export async function call<K extends keyof Api>(name: K, ...args: Parameters<Api[K]>): Promise<Awaited<ReturnType<Api[K]>>> {
  try {
    return (await window.switchman.call(name, ...args)) as Awaited<ReturnType<Api[K]>>
  } catch (e: any) {
    throw new Error(String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
  }
}

export const onState = (cb: (s: AppState) => void) => window.switchman.on('state', cb)
export const onRun = (cb: (r: Run) => void) => window.switchman.on('run', cb)
