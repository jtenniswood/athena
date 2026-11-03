import path from 'node:path'
import { replaceBrowserContract } from './contract'

/** Attach browser gestures to the existing virtual rail and its navigation owner. */
export function useBrowserTimelineScrubbing(source: string, root: string): string {
  return `import { useTimelineScrubbing } from ${JSON.stringify(path.join(root, 'src/experience/ui/timeline-scrubbing'))}\n` + replaceBrowserContract(source, [
    ["  const [pitch, setPitch] = useState(7)", "  const [pitch, setPitch] = useState(7)\n  const scrubbing = useTimelineScrubbing({ root, entries, pitch, onJump })"],
    ['      onPointerLeave={() => {', '      onPointerDown={scrubbing.onPointerDown}\n      onPointerUp={scrubbing.onPointerUp}\n      onPointerCancel={scrubbing.onPointerCancel}\n      onLostPointerCapture={scrubbing.onLostPointerCapture}\n      onClickCapture={scrubbing.onClickCapture}\n      onPointerLeave={() => {\n        scrubbing.onPointerLeave()'],
    ['      onPointerMove={event => {', '      onPointerMove={event => {\n        scrubbing.onPointerMove(event)']
  ])
}
