import { registerPendingBrowserWork, type PendingWorkResult } from './pending-work'

type Save = {
  scope: number
  commit(): Promise<void>
  timer?: ReturnType<typeof setTimeout>
  task?: Promise<void>
  failure?: string
}

/** Own pending save commands; the renderer still owns config values and its write queue. */
export function createBrowserSettingsSaveOwner(id: string, debounceMs = 550) {
  let scope = 0
  let current: Save | null = null
  let release: (() => void) | undefined
  const running = new Set<Promise<void>>()

  const releaseIfIdle = () => {
    if (current || running.size) return
    release?.()
    release = undefined
  }
  const run = (save: Save): Promise<void> => {
    if (save.task) return save.task
    clearTimeout(save.timer)
    const task = Promise.resolve().then(save.commit).then(() => {
      if (current === save) current = null
    }).catch(() => {
      if (current === save && save.scope === scope) {
        save.failure = 'A settings change could not be saved. Reopen Settings and save it before updating.'
      }
    }).finally(() => {
      running.delete(task)
      releaseIfIdle()
    })
    save.task = task
    running.add(task)
    return task
  }
  const prepare = async (): Promise<PendingWorkResult> => {
    for (let attempt = 0; attempt < 8; attempt++) {
      if (current?.failure) return { ready: false, reason: current.failure }
      if (current) void run(current)
      await Promise.all([...running])
      if (current?.failure) return { ready: false, reason: current.failure }
      if (!current && !running.size) return { ready: true }
    }
    return { ready: false, reason: 'New settings changes arrived during the save. Try the update again.' }
  }
  return {
    get scope() { return scope },
    schedule(commit: () => Promise<void>): void {
      if (current) clearTimeout(current.timer)
      const save: Save = { scope, commit }
      current = save
      release ??= registerPendingBrowserWork({ id, prepare })
      save.timer = setTimeout(() => { void run(save) }, debounceMs)
    },
    /** Cancel only unsent edits when the active profile changes; drain older requests. */
    resetScope(): void {
      scope++
      if (current) clearTimeout(current.timer)
      current = null
      releaseIfIdle()
    },
    prepare
  }
}
