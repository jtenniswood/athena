import path from 'node:path'
import { replaceBrowserContract } from './contract'

/** Attach browser gestures to the existing virtual rail and its navigation owner. */
export function useBrowserTimelineScrubbing(source: string, root: string): string {
  return `import { timelinePointerIndex, useTimelineScrubbing } from ${JSON.stringify(path.join(root, 'src/experience/ui/timeline-scrubbing'))}\n` + replaceBrowserContract(source, [
    ['interface TimelineRailProps {', 'interface TimelineRailProps {\n  browserOwner: unknown'],
    ['export function TimelineRail({ activeIndex, entries, loadingId, onJump }: TimelineRailProps)', 'export function TimelineRail({ browserOwner, activeIndex, entries, loadingId, onJump }: TimelineRailProps)'],
    ['  const root = useRef<HTMLDivElement>(null)', '  const root = useRef<HTMLDivElement>(null)\n  const track = useRef<HTMLDivElement>(null)'],
    ['  const [pitch, setPitch] = useState(7)', '  const [pitch, setPitch] = useState(7)\n  const scrubbing = useTimelineScrubbing({ track, owner: browserOwner, entries, onJump })'],
    ['    const scroller = root.current\n\n    if (!scroller', '    const element = track.current\n\n    if (!element'],
    [
      '    const y = pointerY.current - scroller.getBoundingClientRect().top + scroller.scrollTop\n    hover.current = Math.max(0, Math.min(entries.length - 1, y / pitch - 0.5))',
      '    const index = timelinePointerIndex(element, pointerY.current, entries.length)\n    hover.current = index === null ? null : Math.max(0, Math.min(entries.length - 1, index - 0.5))'
    ],
    ['  }, [entries.length, pitch, schedule])', '  }, [entries.length, schedule])'],
    ['      <div className="thread-timeline-track" style=', '      <div className="thread-timeline-track" ref={track} style='],
    ['      onPointerLeave={() => {', '      onPointerDown={scrubbing.onPointerDown}\n      onPointerUp={scrubbing.onPointerUp}\n      onPointerCancel={scrubbing.onPointerCancel}\n      onLostPointerCapture={scrubbing.onLostPointerCapture}\n      onClickCapture={scrubbing.onClickCapture}\n      onPointerLeave={() => {\n        scrubbing.onPointerLeave()'],
    ['      onPointerMove={event => {', '      onPointerMove={event => {\n        scrubbing.onPointerMove(event)']
  ])
}

/** Reuse the timeline index's existing connection/profile/session identity. */
export function exposeBrowserTimelineHistoryOwner(source: string): string {
  return replaceBrowserContract(source, [[
    '  return { ...value, failed: failed === key, loadMore }',
    '  return { ...value, ownerKey: key, failed: failed === key, loadMore }'
  ]])
}

export function useBrowserTimelineOwner(source: string, root: string): string {
  const promptsImport = 'import { derivePromptEntries, isTimelinePromptText, summarizeTimeline } from ' + JSON.stringify(path.join(root, 'src/experience/ui/timeline-prompts'))

  return promptsImport + '\n' + replaceBrowserContract(source, [
    [
      '  if (!railEntries.length) {',
      `  const landmarks = useMemo(() => summarizeTimeline(railEntries), [railEntries])
  const activeLandmark = landmarks.indexes.findLastIndex(index => index <= activeIndex)

  if (!landmarks.entries.length) {`
    ],
    ['height: `min(${railEntries.length * 0.4375}rem, 50%)`', 'height: `min(${landmarks.entries.length * 0.4375}rem, 50%)`'],
    ['        activeIndex={activeIndex}\n        entries={railEntries}', '        activeIndex={activeLandmark}\n        entries={landmarks.entries}'],
    ['      <TimelineRail\n', '      <TimelineRail\n        browserOwner={historyIndex.ownerKey}\n'],
    [
      '        const destination = Math.max(\n          0,\n          start + turn.getBoundingClientRect().top - viewport.getBoundingClientRect().top - 8\n        )',
      `        const destinationFrom = (scrollTop: number) => {
          const viewportRect = viewport.getBoundingClientRect()
          const scale = viewport.currentCSSZoom || viewportRect.height / viewport.offsetHeight || 1
          const delta = turn.getBoundingClientRect().top - viewportRect.top - 8
          return Math.max(0, Math.ceil(scrollTop + delta / scale))
        }
        const destination = destinationFrom(start)`
    ],
    [
      `          viewport.scrollTop = start + (destination - start) * (1 - (1 - progress) ** 3)

          if (progress < 1) {
            jumpFrame.current = requestAnimationFrame(step)
          }`,
      `          if (progress < 1) {
            viewport.scrollTop = start + (destination - start) * (1 - (1 - progress) ** 3)
            jumpFrame.current = requestAnimationFrame(step)
          } else {
            // Earlier turns can finish laying out during the animation.
            viewport.scrollTop = viewport.contains(turn) ? destinationFrom(viewport.scrollTop) : destination
          }`
    ],
    ['  deriveTimelineEntries,\n', ''],
    ["  const storeIds = useStoreSelector(view.$messages, messages =>\n    messages\n      .filter(m => m.role === 'user')", "  const storeIds = useStoreSelector(view.$messages, messages =>\n    messages\n      .filter(m => m.role === 'user' && !m.hidden)"],
    ["      ? all\n          .filter(m => m.role === 'user')", "      ? all\n          .filter(m => m.role === 'user' && !m.hidden)"],
    ['deriveTimelineEntries(rows)', 'derivePromptEntries(rows)'],
    ['    const indexed = indexedEntries ?? []', '    const indexed = (indexedEntries ?? []).filter(entry => isTimelinePromptText(entry.preview))'],
    ['      ? deriveTimelineEntries(', '      ? derivePromptEntries('],
    ['          (history.currentMessages ?? []).map(message => ({\n            id: message.id,\n            rowId: message.rowId,\n            role: message.role,\n            text: messageContentText(message.parts)\n          }))', "          (history.currentMessages ?? [])\n            .filter(message => message.role === 'user' && !message.hidden)\n            .map(message => ({\n              id: message.id,\n              rowId: message.rowId,\n              role: message.role,\n              text: messageContentText(message.parts)\n            }))"]
  ])
}
