import { randomUUID } from 'node:crypto'
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/** One server process owns this bounded store, alongside account preferences. No chat text is stored. */
export function createAndroidPushStore(directory) {
  const file = directory && path.join(directory, 'android-push.json')
  let state = { devices: new Map(), events: new Map() }
  if (file) {
    try {
      const raw = readFileSync(file, 'utf8')
      if (raw.length > 64 * 1024 * 1024) throw new Error('Android push store is too large')
      const saved = JSON.parse(raw)
      if (saved.version !== 1 || !Array.isArray(saved.devices) || !Array.isArray(saved.events) ||
          saved.devices.length > 500 || saved.events.length > 5000) throw new Error('Invalid Android push store')
      state = { devices: new Map(saved.devices), events: new Map(saved.events) }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  const persist = next => {
    if (!file) return
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    const temporary = path.join(directory, `.android-push.${randomUUID()}.tmp`)
    let descriptor
    try {
      descriptor = openSync(temporary, 'wx', 0o600)
      writeFileSync(descriptor, JSON.stringify({ version: 1, devices: [...next.devices], events: [...next.events] }))
      fsyncSync(descriptor)
      closeSync(descriptor); descriptor = undefined
      renameSync(temporary, file)
      const parent = openSync(directory, 'r')
      try { fsyncSync(parent) } finally { closeSync(parent) }
    } finally {
      if (descriptor !== undefined) closeSync(descriptor)
      try { unlinkSync(temporary) } catch (error) { if (error.code !== 'ENOENT') throw error }
    }
  }
  return {
    get devices() { return state.devices },
    get events() { return state.events },
    update(change) {
      const next = structuredClone(state)
      const result = change(next)
      if (next.devices.size > 500 || next.events.size > 5000) throw new Error('Android push storage limit reached')
      persist(next)
      state = next
      return result
    }
  }
}
