import { useLayoutEffect, useRef } from 'react'
import { ReorderableList } from '@/app/chat/sidebar/reorderable-list'

/** Route title drops through the same ordering callback as the grab handle. */
export function BrowserSessionReorderList(props: Parameters<typeof ReorderableList>[0]) {
  const root = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const element = root.current
    if (!element) return
    const reorder = (event: Event) => {
      if (!(event instanceof CustomEvent) || event.target !== element) return
      const { sourceId, targetId, after } = event.detail as { sourceId: string; targetId: string; after: boolean }
      if (sourceId === targetId || !props.ids.includes(sourceId) || !props.ids.includes(targetId)) return
      const next = props.ids.filter(id => id !== sourceId)
      next.splice(next.indexOf(targetId) + Number(after), 0, sourceId)
      props.onReorder(next)
    }
    element.addEventListener('browser-session-reorder', reorder)
    return () => element.removeEventListener('browser-session-reorder', reorder)
  }, [props.ids, props.onReorder])
  return <div ref={root} data-browser-session-order="" className="contents"><ReorderableList {...props} /></div>
}
