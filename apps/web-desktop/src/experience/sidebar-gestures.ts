import { useLayoutEffect, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import type { BrowserEngine } from './contracts/engine'

interface SessionProjectDrag {
  pointerId: number
  source: HTMLElement
  sessionId: string
  profile: string
  startX: number
  startY: number
  active: boolean
  target: HTMLElement | null
  targetProjectId?: string
}

interface SessionReorderDrag {
  pointerId: number
  source: HTMLElement
  sourceId: string
  startX: number
  startY: number
  active: boolean
  target: HTMLElement | null
}

/** The mounted navigation owns project drops and reorder feedback; the engine owns mutations. */
export function useSidebarGestures(root: RefObject<HTMLElement | null>, projects: BrowserEngine['projects'], owner: string) {
  const sessionProjectDrag = useRef<SessionProjectDrag | null>(null)
  const sessionReorderDrag = useRef<SessionReorderDrag | null>(null)
  useLayoutEffect(() => {
    const clearTarget = (drag: SessionProjectDrag) => {
      drag.target?.removeAttribute('data-session-drop-active')
      drag.target = null
    }
    const clearReorderTarget = (drag: SessionReorderDrag) => {
      drag.target?.removeAttribute('data-session-order-drop')
      drag.target = null
    }
    const cancel = () => {
      if (sessionProjectDrag.current) clearTarget(sessionProjectDrag.current)
      if (sessionReorderDrag.current) clearReorderTarget(sessionReorderDrag.current)
      sessionProjectDrag.current = null
      sessionReorderDrag.current = null
    }
    const mounted = (element: HTMLElement | null) => !!element && !!root.current?.contains(element) && element.getClientRects().length > 0
    const finish = (event: PointerEvent, commit: boolean) => {
      const reorder = sessionReorderDrag.current
      if (reorder?.pointerId === event.pointerId) {
        clearReorderTarget(reorder)
        sessionReorderDrag.current = null
      }
      const drag = sessionProjectDrag.current
      if (!drag || drag.pointerId !== event.pointerId) return
      const valid = mounted(drag.source) && mounted(drag.target)
      sessionProjectDrag.current = null
      clearTarget(drag)
      if (!commit || !valid || !drag.active || !drag.targetProjectId) return
      void projects.move(drag.sessionId, drag.targetProjectId, drag.profile)
        .catch(projects.reportFailure)
    }
    const onPointerMove = (event: PointerEvent) => {
      if ((sessionProjectDrag.current && !mounted(sessionProjectDrag.current.source)) ||
          (sessionReorderDrag.current && !mounted(sessionReorderDrag.current.source))) { cancel(); return }
      const reorder = sessionReorderDrag.current
      if (reorder?.pointerId === event.pointerId) {
        if (!reorder.active && Math.hypot(event.clientX - reorder.startX, event.clientY - reorder.startY) >= 6) {
          reorder.active = true
        }
        if (reorder.active) {
          const element = root.current?.ownerDocument.elementFromPoint(event.clientX, event.clientY)
          const candidate = element instanceof Element ? element.closest<HTMLElement>('[data-web-session-id]') : null
          if (!candidate || !root.current?.contains(candidate) || candidate.dataset.webSessionId === reorder.sourceId) {
            clearReorderTarget(reorder)
          } else if (candidate !== reorder.target) {
            clearReorderTarget(reorder)
            const rect = candidate.getBoundingClientRect()
            candidate.dataset.sessionOrderDrop = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
            reorder.target = candidate
          } else {
            const rect = candidate.getBoundingClientRect()
            candidate.dataset.sessionOrderDrop = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
          }
        }
      }

      const drag = sessionProjectDrag.current
      if (!drag || drag.pointerId !== event.pointerId) return
      if (!drag.active && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) return
      drag.active = true
      event.preventDefault()
      const element = root.current?.ownerDocument.elementFromPoint(event.clientX, event.clientY)
      const candidate = element instanceof Element ? element.closest<HTMLElement>('[data-sessions-project]') : null
      const projectId = candidate && root.current?.contains(candidate) ? candidate.dataset.sessionsProject : undefined
      const nextTargetProjectId = projects.eligibleDrop(projectId)
      const nextTarget = nextTargetProjectId ? candidate : null
      if (nextTarget === drag.target) return
      clearTarget(drag)
      drag.target = nextTarget
      if (nextTarget) nextTarget.setAttribute('data-session-drop-active', '')
      drag.targetProjectId = nextTarget ? nextTargetProjectId! : undefined
    }
    const onPointerUp = (event: PointerEvent) => finish(event, true)
    const onPointerCancel = (event: PointerEvent) => finish(event, false)
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel() }
    const onVisibilityChange = () => { if (document.hidden) cancel() }
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('blur', cancel)
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pointermove', onPointerMove, { passive: false })
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)
    return () => {
      cancel()
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('blur', cancel)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerCancel)
    }
  }, [root, projects, owner])
  return (event: ReactPointerEvent<HTMLElement>) => {
    const target = event.target
    if (!(target instanceof Element) || !event.currentTarget.contains(target)) return
    const reorderHandle = target.closest('[data-reorder-handle]')
    if (reorderHandle && event.button === 0) {
      const row = reorderHandle.closest<HTMLElement>('[data-web-session-id]')
      if (row) {
        sessionReorderDrag.current = {
          pointerId: event.pointerId,
          source: row,
          sourceId: row.dataset.webSessionId!,
          startX: event.clientX,
          startY: event.clientY,
          active: false,
          target: null
        }
      }
      return
    }
    const row = target.closest<HTMLElement>('[data-web-session-id]')
    if (!row || target.closest('[data-reorder-handle], [data-row-actions]')) return

    // Sidebar session drags can reorder sessions or move them into a project.
    // Let sortable rows receive the press; their adapter suppresses desktop pane dragging.
    if (!row.querySelector('[data-reorder-handle]')) event.stopPropagation()
    if (event.button !== 0) return
    sessionProjectDrag.current = {
      pointerId: event.pointerId,
      source: row,
      sessionId: row.dataset.webSessionId!,
      profile: row.dataset.webSessionProfile || 'default',
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      target: null,
      targetProjectId: undefined
    }
  }
}
