import { useLayoutEffect } from 'react'
import { beginMediaOperation } from '../platform/reload-safety'

/** Project the mounted voice owner's capture lifetime without copying its state. */
export function useBrowserVoiceLifetime(capturing: boolean): void {
  useLayoutEffect(() => capturing ? beginMediaOperation() : undefined, [capturing])
}
