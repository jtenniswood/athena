import path from 'node:path'
import { replaceBrowserContract } from './contract'

/** Bind positioning to the transcript's existing refs, surface and owner lifetime. */
export function useBrowserThreadSubmitScroll(source: string, root: string): string {
  const target = '  useMessagesBelow({ contentRef, scrollRef, isAtBottom, paneVisible, rows, sessionKey, sessionId: scrollSessionId })'
  return `import { useBrowserSubmitScroll } from ${JSON.stringify(path.join(root, 'src/experience/ui/submit-scroll'))}\n` + replaceBrowserContract(source, [[
    target, target + '\n  useBrowserSubmitScroll({ surfaceId, sessionKey, profile: scrollProfile, visible: paneVisible, scrollRef, contentRef })'
  ]])
}
