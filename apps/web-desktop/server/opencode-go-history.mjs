import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

const hour = 3_600_000
const maxSamples = 800

export function createOpenCodeGoHistory(directory, apiKey) {
  const file = directory && path.join(directory, 'opencode-go-history.json')
  const keyHash = apiKey && createHash('sha256').update(apiKey).digest('hex')
  let history
  let loaded = false

  async function load() {
    loaded = true
    if (!file) return
    try {
      const saved = JSON.parse(await readFile(file, 'utf8'))
      if (saved.version === 1 && saved.keyHash === keyHash && Number.isFinite(saved.renewsAt) &&
          Array.isArray(saved.samples) && saved.samples.length <= maxSamples &&
          saved.samples.every((sample, index, samples) =>
            Number.isFinite(sample?.at) && sample.at < saved.renewsAt &&
            (index === 0 || samples[index - 1].at < sample.at) &&
            Number.isFinite(sample.percent) && sample.percent >= 0 && sample.percent <= 100)) {
        history = saved
      }
    } catch { /* Live quotas still work when saved history is missing or unreadable. */ }
  }

  async function save() {
    if (!file) return
    const temporary = path.join(directory, `.opencode-go-history.${randomUUID()}.tmp`)
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 })
      await writeFile(temporary, JSON.stringify(history), { flag: 'wx', mode: 0o600 })
      await rename(temporary, file)
    } catch {
      await unlink(temporary).catch(() => {})
    }
  }

  // The quota handler calls this once for each uncached provider response.
  return async ({ percent, resetsAt }, at) => {
    const renewsAt = Date.parse(resetsAt)
    if (at >= renewsAt) return []
    if (!loaded) await load()
    // A renewal reported as seconds remaining can shift the timestamp slightly.
    if (!history || Math.abs(renewsAt - history.renewsAt) >= 60_000) {
      history = { version: 1, keyHash, renewsAt, samples: [] }
    }
    const sample = { at, percent }
    const previous = history.samples.at(-1)
    if (!previous || at - previous.at >= hour || at < previous.at) {
      history.renewsAt = renewsAt
      history.samples = [...history.samples.filter(item => item.at < at), sample].slice(-maxSamples)
      await save()
      return history.samples
    }
    return at === previous.at ? [...history.samples.slice(0, -1), sample] : [...history.samples, sample]
  }
}
