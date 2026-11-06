import { isUnderPluginRoot, pluginRoots } from './files'

const unavailable = 'local file access is unavailable in the web app'

/** Mounted UI plugins belong to Athena's hosting service; other files belong to Hermes. */
export function mountedPluginFiles(current: () => Window['hermesDesktop']) {
  const readFileText = async (path: string) => {
    if (!/^https?:/i.test(path)) return current().readFileText(path)
    if (!isUnderPluginRoot(path)) throw new Error(unavailable)
    const response = await fetch(path)
    if (!response.ok) throw new Error(`${response.status}: ${response.statusText}`)
    return { path, text: await response.text() }
  }
  return {
    desktopPluginsRoot: async () => pluginRoots()[0],
    agentPluginsRoot: async () => pluginRoots()[1],
    watchPreviewFile: (path: string) => /^https?:/i.test(path)
      ? Promise.resolve({ ok: false as const, error: 'unsupported' }) : current().watchPreviewFile(path),
    readPluginSource: async (path: string) => {
      const result = await readFileText(path)
      if (!('text' in result)) throw new Error(result.error)
      return result
    },
    readFileText,
    readDir: async (path: string) => {
      if (!/^https?:/i.test(path)) return current().readDir(path)
      if (!isUnderPluginRoot(path)) return { entries: [], error: unavailable }
      const response = await fetch(`${path}/.listing`)
      if (!response.ok) return { entries: [], error: `${response.status}: ${response.statusText}` }
      const raw: unknown = await response.json()
      if (!Array.isArray(raw)) return { entries: [], error: 'Invalid plugin directory listing' }
      const entries = raw.filter((entry): entry is { name: string; type: string } =>
        entry && typeof entry.name === 'string' && entry.name !== '' && entry.name !== '.' && entry.name !== '..' &&
        !/[\\/\0]/.test(entry.name) && (entry.type === 'file' || entry.type === 'directory'))
      return { entries: entries.map(entry => ({ name: entry.name,
        path: `${path.replace(/\/$/, '')}/${encodeURIComponent(entry.name)}`, isDirectory: entry.type === 'directory' })) }
    }
  }
}
