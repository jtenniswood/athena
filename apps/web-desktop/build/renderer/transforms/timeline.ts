import path from 'node:path'
import { replaceBrowserContract } from './contract'

/** Attach browser gestures to the existing virtual rail and its navigation owner. */
export function useBrowserTimelineScrubbing(source: string, root: string): string {
  return `import { useTimelineScrubbing } from ${JSON.stringify(path.join(root, 'src/experience/ui/timeline-scrubbing'))}\n` + replaceBrowserContract(source, [
    ['interface TimelineRailProps {', 'interface TimelineRailProps {\n  browserOwner: unknown'],
    ['export function TimelineRail({ activeIndex, entries, loadingId, onJump }: TimelineRailProps)', 'export function TimelineRail({ browserOwner, activeIndex, entries, loadingId, onJump }: TimelineRailProps)'],
    ["  const [pitch, setPitch] = useState(7)", "  const [pitch, setPitch] = useState(7)\n  const scrubbing = useTimelineScrubbing({ root, owner: browserOwner, entries, pitch, onJump })"],
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

export function useBrowserTimelineOwner(source: string): string {
  return replaceBrowserContract(source, [['      <TimelineRail\n', '      <TimelineRail\n        browserOwner={historyIndex.ownerKey}\n']])
}
