import { useEffect } from 'react'
import { ESCAPE_PRIORITY, isTopEscapeLayer, pushEscapeLayer } from '@/lib/escape-layers'
import { triggerHaptic } from '@/lib/haptics'

export function announceSettingsReset(): void { triggerHaptic('warning') }

/** Embedded settings participate in the engine's nested overlay Escape policy. */
export function useBrowserSettingsEscapeClose(onClose: () => void): void {
  useEffect(() => {
    const release = pushEscapeLayer(ESCAPE_PRIORITY.overlay)
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || !isTopEscapeLayer(ESCAPE_PRIORITY.overlay)) return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', close)
    return () => { window.removeEventListener('keydown', close); release() }
  }, [onClose])
}
