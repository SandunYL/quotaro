import { contextBridge, ipcRenderer } from 'electron'

// The renderer's only door to the system: named calls into the main process's `api`, plus two event streams.
contextBridge.exposeInMainWorld('switchman', {
  call: (name: string, ...args: unknown[]) => ipcRenderer.invoke('call', name, ...args),
  on: (channel: 'state' | 'run', cb: (data: unknown) => void) => {
    const fn = (_e: unknown, data: unknown) => cb(data)
    ipcRenderer.on(channel, fn)
    return () => { ipcRenderer.removeListener(channel, fn) }
  },
})
