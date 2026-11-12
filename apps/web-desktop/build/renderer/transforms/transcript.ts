import path from 'node:path'
import { replaceBrowserContract } from './contract'

/** Bind positioning to the transcript's existing refs, surface and owner lifetime. */
export function useBrowserThreadSubmitScroll(source: string, root: string): string {
  const target = '  useMessagesBelow({ contentRef, scrollRef, isAtBottom, paneVisible, rows, sessionKey, sessionId: scrollSessionId })'
  return `import { useBrowserSubmitScroll } from ${JSON.stringify(path.join(root, 'src/experience/ui/submit-scroll'))}\n` + replaceBrowserContract(source, [[
    target, target + '\n  useBrowserSubmitScroll({ surfaceId, sessionKey, profile: scrollProfile, visible: paneVisible, scrollRef, contentRef })'
  ]])
}

/** Let touch users read a truncated prompt by tapping its card. */
export function expandBrowserMessageOnTap(source: string): string {
  const bubble = `<div className={cn(className, 'cursor-text')} data-selectable-text="true">`
  return replaceBrowserContract(source, [
    [bubble, `<div
        className={cn(className, 'cursor-text')}
        data-selectable-text="true"
        onClick={expandable ? event => {
          const target = event.target
          if (event.defaultPrevented || hasTextSelection() || !(target instanceof Element) || !event.currentTarget.contains(target)) {
            return
          }
          if (target.closest('a[href], button, [role="button"], [role="link"]')) {
            return
          }
          toggleExpanded()
        } : undefined}
      >`],
    ["  const copy = useI18n().t.assistant.thread\n\n  return (\n    <>", `  const copy = useI18n().t.assistant.thread
  const toggleExpanded = () => {
    triggerHaptic('selection')
    onToggleExpanded()
  }

  return (
    <>`],
    ["onClick={() => {\n              triggerHaptic('selection')\n              onToggleExpanded()\n            }}", 'onClick={toggleExpanded}']
  ])
}
