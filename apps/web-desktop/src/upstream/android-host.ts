import { useEffect } from 'react'
import { useStore } from '@nanostores/react'
import { $gatewayState } from '@/store/session'
import { androidWebVisibility, isAndroidApp } from '../platform/android'

/** Read the engine's connection state; never create another conversation or connection store. */
export function useAndroidVisibleConversation(sessionId: string | null, visible: boolean): void {
  const gateway = useStore($gatewayState)
  useEffect(() => {
    if (!isAndroidApp()) return
    const update = () => { void androidWebVisibility(visible && gateway === 'open' && document.visibilityState === 'visible' ? sessionId : null) }
    update()
    const timer = window.setInterval(update, 3000)
    document.addEventListener('visibilitychange', update)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', update)
      void androidWebVisibility(null)
    }
  }, [sessionId, visible, gateway])
}
