// Shapes shared by the main process and the renderer.

export type Service = 'claude' | 'codex'
export type WindowKind = '5h' | 'week'

export interface Account { id: string; service: Service; name: string; dir: string; isDefault: boolean }

export interface Limit { percent: number; resetsAt: number | null } // resetsAt in ms
export interface Usage { five?: Limit; week?: Limit; asOf: number }

export interface AccountView extends Account {
  active: boolean
  exists: boolean
  email?: string
  accountUuid?: string
  usage?: Usage
  tracking?: boolean // Claude Code status-line hook installed
}

export interface AppState {
  platform: string
  accounts: AccountView[]
  shellLinked: boolean
  bells: Record<string, boolean> // `${accountId}:${WindowKind}`
  loginItem: boolean | null // null where the OS has no login items (Linux)
  runs: Run[]
}

export interface Sample { t: number; a: string; k: WindowKind; p: number }

export interface Session {
  id: string
  path: string
  service: Service
  accountId: string
  title: string
  cwd: string
  mtime: number
  live: boolean
}

export interface Msg { role: 'user' | 'assistant'; text: string }

export interface Run {
  id: string
  accountId: string
  service: Service
  cwd: string
  sessionId?: string
  prompt: string
  output: Msg[]
  status: 'running' | 'done' | 'error'
  error?: string
}
