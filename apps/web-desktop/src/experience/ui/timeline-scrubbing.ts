import { useRef, type MouseEvent, type PointerEvent, type RefObject } from 'react'

interface TimelineScrubbing {
  root: RefObject<HTMLDivElement | null>
  owner: unknown
  entries: readonly { id: string }[]
  pitch: number
  onJump(id: string): void
}

/** Navigate through the rail's existing owner without discovering or clicking buttons. */
export function useTimelineScrubbing({ root, owner, entries, pitch, onJump }: TimelineScrubbing) {
  const drag = useRef<{ pointerId: number; x: number; y: number; active: boolean; owner: unknown; lastId?: string } | null>(null)
  const suppressClick = useRef(false)

  const finish = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return
    suppressClick.current = drag.current.active || !Object.is(drag.current.owner, owner)
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  return {
    onPointerDown(event: PointerEvent<HTMLDivElement>) {
      if (event.button !== 0 || !event.isPrimary || drag.current) return
      suppressClick.current = false
      drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, active: false, owner }
    },
    onPointerMove(event: PointerEvent<HTMLDivElement>) {
      const current = drag.current, element = root.current
      if (!current || current.pointerId !== event.pointerId || !element) return
      if (!Object.is(current.owner, owner)) { finish(event); return }
      if (!current.active && Math.hypot(event.clientX - current.x, event.clientY - current.y) < 4) return
      current.active = true
      if (!element.hasPointerCapture(event.pointerId)) element.setPointerCapture(event.pointerId)
      const rect = element.getBoundingClientRect()
      if (event.clientX < rect.left || event.clientX >= rect.right || event.clientY < rect.top || event.clientY >= rect.bottom) return
      const scale = rect.height / element.offsetHeight
      if (!(scale > 0) || !(pitch > 0)) return
      const index = Math.floor(((event.clientY - rect.top) / scale + element.scrollTop) / pitch)
      const entry = entries[index]
      if (!entry || current.lastId === entry.id) return
      current.lastId = entry.id
      onJump(entry.id)
    },
    onPointerUp: finish,
    onPointerCancel: finish,
    onLostPointerCapture: finish,
    onPointerLeave() { if (drag.current && !drag.current.active) drag.current = null },
    onClickCapture(event: MouseEvent<HTMLDivElement>) {
      if (!suppressClick.current || event.detail === 0) return
      suppressClick.current = false
      event.preventDefault()
      event.stopPropagation()
    }
  }
}
