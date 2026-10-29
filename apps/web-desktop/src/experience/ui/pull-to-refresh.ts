/** A downward, single-finger gesture must begin with every nested scroller at its top. */
export function installPullToRefresh(root: HTMLElement, options: {
  enabled(): boolean
  busy(): boolean
  progress(distance: number): void
  refresh(): void
}): () => void {
  let start: { x: number; y: number; id: number } | undefined
  let distance = 0
  const reset = () => { start = undefined; distance = 0; options.progress(0) }
  const atTop = (target: Element) => {
    for (let node: Element | null = target; node && root.contains(node); node = node.parentElement) {
      if (node instanceof HTMLElement && node.scrollTop > 0 && /auto|scroll/.test(getComputedStyle(node).overflowY)) return false
    }
    return true
  }
  const begin = (event: TouchEvent) => {
    reset()
    const target = event.target instanceof Element ? event.target : null
    if (!options.enabled() || options.busy() || event.touches.length !== 1 || !target ||
      target.closest('input,textarea,select,[contenteditable="true"]') || !atTop(target)) return
    const overlay = target.closest('[role="menu"],[role="dialog"]')
    if (overlay && root.contains(overlay)) return
    const touch = event.touches[0]
    start = { x: touch.clientX, y: touch.clientY, id: touch.identifier }
  }
  const move = (event: TouchEvent) => {
    if (!start) return
    const touch = [...event.touches].find(touch => touch.identifier === start!.id)
    if (!touch || event.touches.length !== 1 || options.busy() || !options.enabled()) { reset(); return }
    const dy = touch.clientY - start.y, dx = Math.abs(touch.clientX - start.x)
    if (dy < -8 || (dx > 10 && dx > dy)) { reset(); return }
    if (dy <= 6) { distance = 0; options.progress(0); return }
    if (!event.cancelable) { reset(); return }
    event.preventDefault()
    distance = Math.min(64, Math.max(0, dy / 2))
    options.progress(distance)
  }
  const end = () => {
    const refresh = Boolean(start) && distance >= 48
    reset()
    if (refresh && !options.busy() && options.enabled()) options.refresh()
  }
  root.addEventListener('touchstart', begin, { passive: true })
  root.addEventListener('touchmove', move, { passive: false })
  root.addEventListener('touchend', end)
  root.addEventListener('touchcancel', reset)
  return () => {
    root.removeEventListener('touchstart', begin); root.removeEventListener('touchmove', move)
    root.removeEventListener('touchend', end); root.removeEventListener('touchcancel', reset)
    start = undefined
  }
}
