import { copyTextThroughSelection } from '@/lib/clipboard'
import { browserCapabilities } from './capabilities'

// Capture the browser method before the renderer installs its Electron shim,
// which redirects navigator.clipboard.writeText back into this bridge.
const nativeWriteText = navigator.clipboard?.writeText?.bind(navigator.clipboard)

/** Read the first image off the clipboard, if any (modern Chromium Clipboard
 *  API). Returns null when there is none or permission is denied. */
export async function clipboardImageAsFile(): Promise<null | Blob> {
  try {
    if (!browserCapabilities().clipboard || !navigator.clipboard?.read) {
      return null
    }

    const items = await navigator.clipboard.read()

    for (const item of items) {
      const type = item.types.find(t => t.startsWith('image/'))

      if (type) {
        const blob = await item.getType(type)

        if (blob && blob.size > 0) {
          return blob
        }
      }
    }
  } catch {
    // Permission denied / clipboard not focused — behave as "no image".
  }

  return null
}

export async function readClipboard(): Promise<string> {
  try {
    if (!browserCapabilities().clipboard) return ''
    return await navigator.clipboard.readText()
  } catch { return '' }
}

export async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (nativeWriteText) {
      await nativeWriteText(text)
      return true
    }
  } catch {
    // Fall through to the selection based copy path for insecure origins or
    // browsers that deny the asynchronous Clipboard API.
  }

  if (!copyTextThroughSelection(text)) {
    throw new Error('Could not copy text to the clipboard')
  }
  return true
}
