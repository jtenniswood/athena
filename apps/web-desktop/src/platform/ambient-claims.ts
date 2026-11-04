import { runtimeConfig } from './runtime'

const REPLY_TIMEOUT_MS = 750
const MAX_PENDING_CLAIMS = 64
const pending = new Map<number, { timer: number; resolve(owns: boolean): void }>()
let worker: SharedWorker | undefined
let nextId = 0
let unavailable = false
let listening = false

function settle(id: number, owns: boolean): void {
  const request = pending.get(id)
  if (!request) return
  pending.delete(id)
  window.clearTimeout(request.timer)
  request.resolve(owns)
}

function release(disable = false): void {
  unavailable ||= disable
  try { worker?.port.close() } catch { /* The transport may already be gone. */ }
  worker = undefined
  for (const id of pending.keys()) settle(id, true)
}

function connect(): SharedWorker {
  if (worker) return worker
  const next = new SharedWorker(new URL('./ambient-claims.worker.ts', import.meta.url), {
    type: 'module', name: 'athena-ambient-claims'
  })
  worker = next
  next.onerror = event => { event.preventDefault(); release(true) }
  next.port.onmessageerror = () => release(true)
  next.port.onmessage = ({ data }) => {
    if (typeof data?.owns === 'boolean') settle(data.id, data.owns)
  }
  if (!listening) {
    window.addEventListener('pagehide', () => release())
    listening = true
  }
  next.port.start()
  return next
}

/** Share one-shot cues without storing conversation state or silencing unsupported hosts. */
export async function claimBrowserAmbientCue(key: string): Promise<boolean> {
  if (unavailable || typeof SharedWorker !== 'function' || pending.size >= MAX_PENDING_CLAIMS) return true
  try {
    const scope = runtimeConfig().gateway.id
    const owner = connect()
    return new Promise(resolve => {
      const id = ++nextId
      const timer = window.setTimeout(() => settle(id, true), REPLY_TIMEOUT_MS)
      pending.set(id, { timer, resolve })
      try { owner.port.postMessage({ id, scope, key: String(key ?? '') }) }
      catch { release(true) }
    })
  } catch {
    release(true)
    return true
  }
}
