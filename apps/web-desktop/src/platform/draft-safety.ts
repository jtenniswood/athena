export interface DraftSnapshot {
  blocked: boolean
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

/** Register the renderer-owned draft store with the browser update boundary. */
export function registerBrowserDraftSafety(next: BrowserDraftSafetyOwner): void {
  owner = next
}

/** Start a fresh synchronous snapshot before asking mounted composers to flush. */
export function beginBrowserDraftSnapshot(): void {
  blocked = false
}

/** Mark the snapshot unsafe when any composer cannot leave its current state. */
export function blockBrowserDraftSnapshot(): void {
  blocked = true
}

export function browserDraftSnapshot(): DraftSnapshot | undefined {
  if (!owner) return undefined
  return { ...owner.snapshot(), blocked }
}

export async function flushBrowserDrafts(): Promise<void> {
  await owner?.flush()
}
