import { beginOperation } from './reload-safety'
import { servingBase } from '../web-bridge/gateways'

/** The shared Node service serves both mounted plugin roots and their listings. */
export const pluginRoots = () => [`${servingBase()}/desktop-plugins`, `${servingBase()}/plugins`]

/** Admit the normalized asset URL, before either file or directory reads fetch it. */
export function isUnderPluginRoot(path: string): boolean {
  try {
    const target = new URL(path)
    if (target.username || target.password || target.search || target.hash) return false
    // Hosts decode these separators after URL parsing; they must not create a
    // different path from the one whose root boundary was checked here.
    if (/%2f|%5c/i.test(target.pathname)) return false
    return pluginRoots().some(root => {
      const allowed = new URL(root)
      return target.origin === allowed.origin &&
        (target.pathname === allowed.pathname || target.pathname.startsWith(`${allowed.pathname}/`))
    })
  } catch { return false }
}

/**
 * Browser-file registry. The renderer is path-based: in Electron it reads a
 * file off disk by absolute path. A browser has no paths — only File/Blob
 * objects from `<input type=file>`, drop/paste events and the clipboard — so
 * we register those blobs under a synthetic handle (`web-file://<n>`, a shape
 * the renderer accepts anywhere a path is expected) and answer
 * readFileDataUrl / readFileDataUrlForAttach by resolving the handle back to
 * the blob and reading its bytes. The same "memory file" idea as the plugin
 * mechanism (same-origin fetch), but for blobs held by the page instead of
 * served paths.
 */
let webFileSeq = 0
const webFiles = new Map<string, Blob>()
const WEB_FILE_PREFIX = 'web-file://'

export function isWebFileHandle(path: string): boolean {
  return path.startsWith(WEB_FILE_PREFIX)
}

export function registerWebFile(blob: Blob, name?: string): string {
  const seq = ++webFileSeq
  const filename = sanitizeWebFileName(name || mimeToFilename(blob.type, `file${seq}`))
  const handle = `${WEB_FILE_PREFIX}${seq}/${filename}`
  webFiles.set(handle, blob)
  return handle
}

/** Derive a sane default filename from a blob MIME (the renderer's pathLabel
 *  shows the last path segment and imageFilenameFromPath uses it for the
 *  gateway upload name), so a clipboard paste isn't labelled by a bare number. */
function mimeToFilename(type: string, fallback: string): string {
  const m = /^image\/([\w+-]+)/.exec(type || '')

  if (m) {
    const ext = m[1].toLowerCase()

    return `image.${ext === 'jpeg' ? 'jpg' : ext}`
  }

  return fallback
}

/** A browser File name never contains a path separator, but guard anyway so
 *  pathLabel() always extracts exactly one segment — the real filename. Kept
 *  short so an over-long name can't produce an unwieldy handle. */
function sanitizeWebFileName(name: string): string {
  const clean = name.replace(/[\\/]/g, '_').replace(/\s+/g, ' ').trim().replace(/^\.+/, '')

  return clean.slice(0, 120) || 'file'
}

export function webFileAsDataUrl(handle: string): Promise<string> {
  const blob = webFiles.get(handle)

  if (!blob) {
    return Promise.reject(new Error(`local file access is unavailable in the web app (${handle})`))
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Failed to read browser file'))
    reader.readAsDataURL(blob)
  })
}

let cancelPicker: (() => void) | undefined

/** Each request owns its input; removing it cannot affect another draft's picker. */
export async function pickBrowserFiles(options?: { directories?: boolean; multiple?: boolean; filters?: Array<{ extensions: string[] }> }): Promise<File[]> {
  // Folders have no single byte payload a remote gateway can stage.
  if (options?.directories) return []
  const input = document.createElement('input')
  input.type = 'file'
  input.style.display = 'none'
  input.multiple = options?.multiple !== false
  input.webkitdirectory = false
  input.accept = acceptsFor(options?.filters)
  document.body.appendChild(input)
  try { return await pickWithInput(input) }
  finally { input.remove() }
}

/** Open synchronously in the user gesture; a newer request cancels the old owner. */
export function pickWithInput(input: HTMLInputElement): Promise<File[]> {
  cancelPicker?.()
  const finish = beginOperation()
  return new Promise((resolve, reject) => {
    let settled = false
    let pendingTimer: ReturnType<typeof setTimeout> | undefined
    const cleanup = (): boolean => {
      if (settled) return false
      settled = true
      clearTimeout(pendingTimer)
      input.removeEventListener('change', onChange)
      input.removeEventListener('cancel', onCancel)
      if (cancelPicker === onCancel) cancelPicker = undefined
      finish()
      return true
    }
    function settle(files: File[]): void { if (cleanup()) resolve(files) }
    function onChange(): void { settle(Array.from(input.files ?? [])) }
    function onCancel(): void { settle([]) }
    cancelPicker = onCancel
    try {
      input.value = ''
      input.addEventListener('change', onChange)
      input.addEventListener('cancel', onCancel)
      // Retain the existing deadline for clients that omit the cancel event.
      pendingTimer = setTimeout(onCancel, 120_000)
      input.click()
    } catch (error) { if (cleanup()) reject(error) }
  })
}

/** Map Electron-style `filters[].extensions` to the browser `accept` list. */
export function acceptsFor(filters?: Array<{ extensions: string[] }>): string {
  return (filters ?? []).flatMap(f => f.extensions).map(ext => `.${ext.toLowerCase()}`).join(',')
}

