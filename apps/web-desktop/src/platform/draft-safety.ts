export interface DraftSnapshot {
  blocked: boolean
  reason?: string
  storageKey: string
  texts: Record<string, string>
  attachments: number
}

export interface BrowserDraftSafetyOwner {
  snapshot(): Omit<DraftSnapshot, 'blocked'>
  flush(): Promise<void>
}

let owner: BrowserDraftSafetyOwner | undefined
let blocked = false
let reason: string | undefined

/** Register the renderer-owned draft store with the browser update boundary. */
export function registerBrowserDraftSafety(next: BrowserDraftSafetyOwner): void {
  owner = next
}

/** Start a fresh synchronous snapshot before asking mounted composers to flush. */
export function beginBrowserDraftSnapshot(): void {
  blocked = false
  reason = undefined
}

/** Mark the snapshot unsafe when any composer cannot leave its current state. */
export function blockBrowserDraftSnapshot(message?: string): void {
  blocked = true
  if (message) reason = message
}

export function browserDraftSnapshot(): DraftSnapshot | undefined {
  if (!owner) return undefined
  return { ...owner.snapshot(), blocked, reason }
}

export async function flushBrowserDrafts(): Promise<void> {
  await owner?.flush()
}
