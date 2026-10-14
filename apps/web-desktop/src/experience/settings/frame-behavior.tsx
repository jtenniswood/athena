import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useLocation } from 'react-router'
import { useBrowserSettingsEscapeClose } from '../../upstream/settings-interactions'
import { OverlayView } from '../../upstream/browser-api'
import { useBrowserOverlayFocus } from '../ui/overlay-focus'

export type SettingsFrameVariant = 'fullscreen' | 'embedded'
const queries: Record<SettingsFrameVariant, string> = {
  fullscreen: '(width < 56rem), (pointer: coarse) and (max-height: 27rem)',
  embedded: '(width < 48rem), (pointer: coarse) and (max-height: 27rem)'
}

/** Both frame variants share destination, compact navigation, and focus behavior. */
export function useSettingsFrame(variant: SettingsFrameVariant, activeIdentity: string) {
  const location = useLocation()
  const query = queries[variant]
  const compact = useSyncExternalStore(change => {
    const media = window.matchMedia(query)
    media.addEventListener('change', change)
    return () => media.removeEventListener('change', change)
  }, () => window.matchMedia(query).matches, () => false)
  const navigation = useRef<HTMLElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const focus = useRef(false)
  const previousIdentity = useRef(activeIdentity)
  const [presentation, setPresentation] = useState<{ mode: 'automatic' | 'detail' | 'menu'; locationKey?: string }>({ mode: 'automatic' })
  const params = new URLSearchParams(location.search)
  const directTarget = ['tab', 'pview', 'kview', 'setting', 'field'].some(key => params.has(key))
  const showingDetail = Boolean(activeIdentity) && (!compact || presentation.mode === 'detail' ||
    (directTarget && (presentation.mode === 'automatic' || presentation.locationKey !== location.key)))
  useEffect(() => {
    if (previousIdentity.current === activeIdentity) return
    previousIdentity.current = activeIdentity
    if (activeIdentity) setPresentation({ mode: 'detail' })
  }, [activeIdentity])
  useLayoutEffect(() => {
    if (!compact || !focus.current) return
    focus.current = false
    if (showingDetail) heading.current?.focus()
    else navigation.current?.querySelector<HTMLButtonElement>('[aria-current="page"]')?.focus()
  }, [compact, showingDetail, activeIdentity])
  return {
    compact, showingDetail, navigation, heading,
    select: (command: () => void) => { focus.current = compact; command(); setPresentation({ mode: 'detail' }) },
    back: () => { focus.current = true; setPresentation({ mode: 'menu', locationKey: location.key }) }
  }
}

function EmbeddedSurface({ children, title, onClose }: { children: ReactNode; title: string; onClose: () => void }) {
  const surface = useBrowserOverlayFocus()
  useBrowserSettingsEscapeClose(onClose)
  return <section aria-label={title} aria-modal="true" className="browser-settings-surface" data-overlay-surface="" ref={surface} role="dialog" tabIndex={-1}>{children}</section>
}

/** The fullscreen host already owns overlay focus and nested Escape handling. */
export function SettingsFrameSurface({ variant, title, closeLabel, onClose, children }: {
  variant: SettingsFrameVariant; title: string; closeLabel: string; onClose: () => void; children: ReactNode
}) {
  return variant === 'fullscreen'
    ? <OverlayView closeLabel={closeLabel} onClose={onClose} rootClassName="browser-settings-fullscreen-card" contentClassName="browser-settings-fullscreen-content">{children}</OverlayView>
    : <EmbeddedSurface title={title} onClose={onClose}>{children}</EmbeddedSurface>
}
