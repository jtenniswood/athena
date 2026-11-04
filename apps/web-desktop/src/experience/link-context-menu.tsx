import { useEffect, useState } from 'react'
import { writeClipboard } from '../platform/clipboard'
import { Codicon } from '../upstream/browser-api'
import { openBrowserExternalLink } from '../upstream/external-links'
import { reportActionFailure } from './action-errors'
import { BrowserActionSurface, type BrowserActionAnchor } from './ui/action-surface'
import { useMobileBrowser } from './ui/use-compact-browser'

/** Link gestures take precedence over the pane's background context menu. */
export function BrowserLinkContextMenu() {
  const compact = useMobileBrowser()
  const [link, setLink] = useState<{ href: string; anchor: BrowserActionAnchor } | null>(null)
  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null
      if (!anchor || anchor.closest('[contenteditable="true"]')) return
      const href = anchor.href
      if (!/^https?:\/\//i.test(href)) return
      event.preventDefault()
      event.stopPropagation()
      const rect = anchor.getBoundingClientRect()
      setLink({ href, anchor: { x: event.clientX || rect.left, y: event.clientY || rect.bottom, returnFocus: anchor } })
    }
    window.addEventListener('contextmenu', onContextMenu, true)
    return () => window.removeEventListener('contextmenu', onContextMenu, true)
  }, [])
  return <BrowserActionSurface title="Link" hideTitle compact={compact} anchor={link?.anchor ?? null} onClose={() => setLink(null)} actions={[
    { key: 'open-link', label: 'Open in browser tab', icon: <Codicon name="link-external" />, run: () => {
      if (link) void openBrowserExternalLink(link.href)
    } },
    { key: 'copy-link', label: 'Copy URL', icon: <Codicon name="copy" />, run: () => {
      if (link) void writeClipboard(link.href).catch(() => reportActionFailure('Could not copy URL.'))
    } }
  ]} />
}
