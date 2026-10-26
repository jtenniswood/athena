import { useAui, useAuiState } from '@assistant-ui/react'
import { useCallback } from 'react'

// The pinned renderer still uses the removed runtime hooks. Keep their
// reactive scope binding until it migrates to the assistant-ui client API.
export function useComposerRuntime() {
  const aui = useAui()
  const runtime = useAuiState(useCallback(() => aui.composer.source ? aui.composer().__internal_getRuntime?.() : undefined, [aui]))
  if (!runtime) throw new Error('ComposerRuntime is not available')
  return runtime
}

export function useMessageRuntime() {
  const aui = useAui()
  const runtime = useAuiState(useCallback(() => aui.message.source ? aui.message().__internal_getRuntime?.() : undefined, [aui]))
  if (!runtime) throw new Error('MessageRuntime is not available')
  return runtime
}

export function useThreadRuntime() {
  const aui = useAui()
  const runtime = useAuiState(useCallback(() => aui.thread.source ? aui.thread().__internal_getRuntime?.() : undefined, [aui]))
  if (!runtime) throw new Error('ThreadRuntime is not available')
  return runtime
}
