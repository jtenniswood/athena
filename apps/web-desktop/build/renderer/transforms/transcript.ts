import path from 'node:path'
import { replaceBrowserContract } from './contract'

/** Bind positioning to the transcript's existing refs, surface and owner lifetime. */
export function useBrowserThreadSubmitScroll(source: string, root: string): string {
  const target = '  useMessagesBelow({ contentRef, scrollRef, isAtBottom, paneVisible, rows, sessionKey, sessionId: scrollSessionId })'
  return `import { useBrowserSubmitScroll } from ${JSON.stringify(path.join(root, 'src/experience/ui/submit-scroll'))}\n` + replaceBrowserContract(source, [[
    target, target + '\n  useBrowserSubmitScroll({ surfaceId, sessionKey, profile: scrollProfile, visible: paneVisible, scrollRef, contentRef })'
  ]])
}

/** Mount the selection action with the visible transcript and its composer identity. */
export function useBrowserTranscriptQuote(source: string, root: string): string {
  const owner = JSON.stringify(path.join(root, 'src/experience/ui/quote-selection'))
  const target = '      {secondaryWindow && ('
  return `import { BrowserQuoteSelection } from ${owner}\n` + replaceBrowserContract(source, [[
    target, `      <BrowserQuoteSelection surfaceId={surfaceId} sessionKey={sessionKey} profile={scrollProfile} visible={paneVisible && !sessionLoading} scrollRef={scrollRef} contentRef={contentRef} />\n${target}`
  ]])
}

/** Let sent prompts grow with their text and give their controls a separate row. */
export function showFullBrowserUserMessage(source: string): string {
  const clampHook = source.match(/\/\*\* Sticky human bubbles clamp[\s\S]*?(?=export const UserMessage:)/)?.[0]
  const expandButton = source.match(/^        \{expandable && \([\s\S]*?^        \)\}\n/m)?.[0]
  const clampedBody = source.match(/^    <div\n      className=\{cn\(clampActive[\s\S]*?^    <\/div>/m)?.[0]
  const spectatorButton = source.match(/^                  \/\/ Spectator transcript:[\s\S]*?^                  <\/button>/m)?.[0]
  if (!clampHook || !expandButton || !clampedBody || !spectatorButton) {
    throw new Error('Browser user message layout changed')
  }

  return replaceBrowserContract(source, [
    ['useEffect, useRef, useState', 'useEffect, useState'],
    ["import { useResizeObserver } from '@/hooks/use-resize-observer'\n", ''],
    [clampHook, ''],
    [source.match(/^  \/\/ Watch windows spectate[\s\S]*? = useUserBubbleClamp\(readOnly, touch\)\n/m)?.[0] ?? '', '  const readOnly = isWatchWindow()\n'],
    [clampedBody, '    <UserMessageText className="wrap-anywhere" text={messageText} />'],
    ['  expandable: boolean\n  expanded: boolean\n  onToggleExpanded: () => void\n  showRestore: boolean\n  showStop: boolean\n', ''],
    ['  editable,\n  expandable,\n  expanded,\n  onToggleExpanded,\n  showRestore,\n  showStop\n', '  editable\n'],
    [source.match(/^\/\*\* Touch bubble:[\s\S]*?(?=function TouchUserBubble)/m)?.[0] ?? '', ''],
    ['      <div className={cn(\'flex justify-end\', (showStop || showRestore) && \'pr-11\')}>', '      <div className="browser-user-message-edit">'],
    [expandButton, ''],
    [source.match(/^                    expandable=\{bodyClamped\}[\s\S]*?^                    showStop=\{showStop\}\n/m)?.[0] ?? '', ''],
    [spectatorButton, `                  <div className={cn(bubbleClassName, 'cursor-text')} data-selectable-text="true">
                    {bubbleContent}
                  </div>`],
    ['cursor-pointer pr-9 text-[length:var(--conversation-text-font-size)] leading-(--dt-line-height) text-foreground/95 transition-colors', 'browser-user-message cursor-pointer text-[length:var(--conversation-text-font-size)]'],
    ['        \'pointer-events-none absolute right-2 bottom-2 z-10 flex items-center gap-1 rounded-md bg-(--dt-user-bubble) pl-1 transition-opacity\',', "        'browser-user-message-controls pointer-events-none flex items-center gap-1 transition-opacity',"],
    ['                className="relative w-full"\n', '                className="browser-user-message-layout relative w-full"\n']
  ])
}

/** Keep the renderer's response grouping and add a single browser disclosure. */
export function useBrowserResponseActivity(source: string, root: string): string {
  const owner = JSON.stringify(path.join(root, 'src/experience/response-activity'))
  return `import { BrowserResponseActivity } from ${owner}\n` + replaceBrowserContract(source, [[
    `          {section.indices.map(index => (
            <ThreadPrimitive.MessageByIndex components={components} index={index} key={index} />
          ))}`,
    `          <BrowserResponseActivity indices={section.indices}>
            {section.indices.map(index => (
              <ThreadPrimitive.MessageByIndex components={components} index={index} key={index} />
            ))}
          </BrowserResponseActivity>`
  ]])
}

/** Mark public commentary at the same boundary as its Markdown and timestamp. */
export function markBrowserCommentaryParts(source: string, root: string): string {
  const owner = JSON.stringify(path.join(root, 'src/experience/response-activity'))
  return `import { BrowserCommentaryPart } from ${owner}\n` + replaceBrowserContract(source, [[
    `    <>
      <TimelineTimestamp className="mb-0.5 block" completedAt={completedAt} timestamp={timestamp} />
      <MarkdownText />
    </>`,
    `    <BrowserCommentaryPart>
      <TimelineTimestamp className="mb-0.5 block" completedAt={completedAt} timestamp={timestamp} />
      <MarkdownText />
    </BrowserCommentaryPart>`
  ]])
}
