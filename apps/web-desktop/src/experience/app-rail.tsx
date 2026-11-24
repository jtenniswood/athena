import { useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { browserPreference, useBrowserPreference } from '../platform/preferences'

export type AppRailItem = { key: string; button: ReactNode }
type Insertion = { key: string; after: boolean }

export const reorderableRailButton = { draggable: true, 'aria-keyshortcuts': 'Alt+ArrowUp Alt+ArrowDown' } as const

// Fill in new controls in their default positions without forgetting hidden controls.
function completeOrder(saved: readonly string[], defaults: readonly string[]): string[] {
  const order = [...saved]
  for (const [index, key] of defaults.entries()) {
    if (order.includes(key)) continue
    const next = defaults.slice(index + 1).find(candidate => order.includes(candidate))
    order.splice(next ? order.indexOf(next) : order.length, 0, key)
  }
  return order
}

function railItemFor(target: EventTarget, rail: HTMLElement): HTMLElement | null {
  if (!(target instanceof Element)) return null
  const item = target.closest<HTMLElement>('[data-rail-key]')
  return item?.parentElement === rail ? item : null
}

function insertionAt(rail: HTMLElement, position: number): Insertion | null {
  const items = rail.querySelectorAll<HTMLElement>('[data-rail-key]')
  for (const item of items) {
    const bounds = item.getBoundingClientRect()
    if (position < bounds.top + bounds.height / 2) return { key: item.dataset.railKey!, after: false }
  }
  const last = items[items.length - 1]
  return last ? { key: last.dataset.railKey!, after: true } : null
}

export function BrowserAppRail({ items, rail, onMove, onContextMenu }: {
  items: readonly AppRailItem[]
  rail: RefObject<HTMLDivElement | null>
  onMove: (key: string, order: string[]) => void
  onContextMenu: React.MouseEventHandler<HTMLDivElement>
}) {
  const saved = useBrowserPreference('appRailOrder')
  const order = completeOrder(saved, items.map(item => item.key))
  const byKey = new Map(items.map(item => [item.key, item.button]))
  const visible = order.filter(key => byKey.get(key) != null)
  const dragged = useRef<string | null>(null)
  const focusAfterMove = useRef<HTMLButtonElement | null>(null)
  const [source, setSource] = useState<string | null>(null)
  const [insertion, setInsertion] = useState<Insertion | null>(null)

  useLayoutEffect(() => {
    const button = focusAfterMove.current
    focusAfterMove.current = null
    button?.focus({ preventScroll: true })
  }, [saved])

  function move(key: string, target: Insertion) {
    if (key === target.key) return
    const next = order.filter(candidate => candidate !== key)
    next.splice(next.indexOf(target.key) + (target.after ? 1 : 0), 0, key)
    if (next.every((candidate, index) => candidate === order[index])) return
    browserPreference('appRailOrder').write(next)
    onMove(key, next)
  }

  function finishDrag() {
    dragged.current = null
    setSource(null)
    setInsertion(null)
  }

  function beginDrag(event: DragEvent<HTMLDivElement>) {
    const key = railItemFor(event.target, event.currentTarget)?.dataset.railKey
    if (!key) return
    dragged.current = key
    setSource(key)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('application/x-athena-app-rail', key)
  }

  function hover(event: DragEvent<HTMLDivElement>) {
    if (!dragged.current) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const target = insertionAt(event.currentTarget, event.clientY)
    setInsertion(target?.key === dragged.current ? null : target)
  }

  function drop(event: DragEvent<HTMLDivElement>) {
    const key = dragged.current
    if (!key) return
    event.preventDefault()
    const target = insertionAt(event.currentTarget, event.clientY)
    finishDrag()
    if (target) move(key, target)
  }

  function reorderWithKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return
    const button = event.target
    if (!(button instanceof HTMLButtonElement) || !button.draggable) return
    const key = railItemFor(button, event.currentTarget)?.dataset.railKey
    if (!key) return
    event.preventDefault()
    event.stopPropagation()
    const after = event.key === 'ArrowDown'
    const target = visible[visible.indexOf(key) + (after ? 1 : -1)]
    if (!target) return
    focusAfterMove.current = button
    move(key, { key: target, after })
  }

  return <div className="browser-app-rail" ref={rail} tabIndex={-1} onContextMenu={onContextMenu}
    onDragStart={beginDrag} onDragOver={hover} onDrop={drop} onDragEnd={finishDrag} onKeyDown={reorderWithKeyboard}
    onDragLeave={event => {
      if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setInsertion(null)
    }}>
    {visible.map(key => <div key={key} className="browser-app-rail-item" data-rail-key={key}
      data-rail-dragging={source === key || undefined}
      data-rail-insertion={insertion?.key === key ? insertion.after ? 'after' : 'before' : undefined}>
      {byKey.get(key)}
    </div>)}
  </div>
}
