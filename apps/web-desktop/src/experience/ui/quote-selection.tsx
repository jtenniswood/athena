import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { usePaneVisible } from '@/components/pane-shell/pane-visibility'
import { useI18n } from '@/i18n'
import './quote-selection.css'

const messageText = '[data-slot="aui_assistant-message-content"], [data-slot="aui_user-message-text"]'
const composers = new Map<string, (quote: string) => boolean>()

/** Register the live composer for this mounted transcript's surface. */
export function useBrowserComposerQuote(surfaceId: string | null, enabled: boolean, insert: (quote: string) => boolean) {
  const visible = usePaneVisible()
  useLayoutEffect(() => {
    if (!surfaceId || !visible || !enabled) return

    composers.set(surfaceId, insert)
    return () => { composers.delete(surfaceId) }
  }, [surfaceId, visible, enabled, insert])
}

function readSelection(content: HTMLElement) {
  const selection = window.getSelection()
  if (!selection?.rangeCount || selection.isCollapsed) return null

  const range = selection.getRangeAt(0)
  const insideMessage = (node: Node) => {
    const element = node instanceof Element ? node : node.parentElement
    return element && content.contains(element) && element.closest(messageText)
      && !element.closest('[contenteditable], input, textarea, [role="button"], button:not(:has([data-slot="aui_user-message-text"]))')
  }
  if (!insideMessage(range.startContainer) || !insideMessage(range.endContainer)) return null

  const text = selection.toString()
  return text.trim() ? { range, selection, text } : null
}

interface SelectionPosition {
  left: number
  top: number
  bottom: number
  viewportLeft: number
  viewportRight: number
  viewportTop: number
  viewportBottom: number
  preferBelow: boolean
}

function selectionPosition(range: Range, scroller: HTMLElement): SelectionPosition | null {
  const scrollerRect = scroller.getBoundingClientRect()
  const viewport = window.visualViewport
  const viewportLeft = viewport?.offsetLeft ?? 0
  const viewportTop = viewport?.offsetTop ?? 0
  const viewportRight = viewportLeft + (viewport?.width ?? window.innerWidth)
  const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight)
  const left = Math.max(viewportLeft, scrollerRect.left)
  const right = Math.min(viewportRight, scrollerRect.right)
  const top = Math.max(viewportTop, scrollerRect.top)
  const bottom = Math.min(viewportBottom, scrollerRect.bottom)
  const rects = Array.from(range.getClientRects()).filter(rect =>
    rect.width > 0 && rect.height > 0 && rect.right > left && rect.left < right && rect.bottom > top && rect.top < bottom
  )
  const first = rects[0]
  const last = rects.at(-1)
  if (!first || !last) return null

  // Leave space above the selection for the platform's touch editing menu.
  const preferBelow = window.matchMedia('(pointer: coarse)').matches
  const anchor = preferBelow ? last : first
  return {
    left: (Math.max(left, anchor.left) + Math.min(right, anchor.right)) / 2,
    top: Math.max(top, first.top),
    bottom: Math.min(bottom, last.bottom),
    viewportLeft, viewportRight, viewportTop, viewportBottom, preferBelow
  }
}

interface QuoteSelectionProps {
  surfaceId: string | null
  sessionKey?: string | null
  profile?: string
  visible: boolean
  scrollRef: RefObject<HTMLElement | null>
  contentRef: RefObject<HTMLElement | null>
}

export function BrowserQuoteSelection({ surfaceId, sessionKey, profile, visible, scrollRef, contentRef }: QuoteSelectionProps) {
  const label = useI18n().t.rightSidebar.addToChat
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [position, setPosition] = useState<SelectionPosition | null>(null)

  useLayoutEffect(() => {
    const content = contentRef.current
    const scroller = scrollRef.current
    setPosition(null)
    if (!visible || !surfaceId || !content || !scroller) return

    let frame = 0
    let dragging = false
    const update = () => {
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        const selected = !dragging && composers.has(surfaceId) && readSelection(content)
        setPosition(selected ? selectionPosition(selected.range, scroller) : null)
      })
    }
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || buttonRef.current?.contains(event.target as Node)) return
      dragging = true
      setPosition(null)
    }
    const onPointerEnd = () => {
      dragging = false
      update()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !buttonRef.current) return
      event.preventDefault()
      event.stopPropagation()
      readSelection(content)?.selection.removeAllRanges()
      setPosition(null)
    }

    document.addEventListener('selectionchange', update)
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('pointerup', onPointerEnd, true)
    window.addEventListener('pointercancel', onPointerEnd, true)
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    const viewport = window.visualViewport
    viewport?.addEventListener('scroll', update)
    viewport?.addEventListener('resize', update)
    return () => {
      document.removeEventListener('selectionchange', update)
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('pointerup', onPointerEnd, true)
      window.removeEventListener('pointercancel', onPointerEnd, true)
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
      viewport?.removeEventListener('scroll', update)
      viewport?.removeEventListener('resize', update)
      window.cancelAnimationFrame(frame)
    }
  }, [surfaceId, sessionKey, profile, visible, scrollRef, contentRef])

  useLayoutEffect(() => {
    const button = buttonRef.current
    if (!position || !button) return

    const { width, height } = button.getBoundingClientRect()
    const { left, top, bottom, viewportLeft, viewportRight, viewportTop, viewportBottom, preferBelow } = position
    const margin = 8
    const gap = preferBelow ? 14 : 6
    const above = top - gap - height
    const below = bottom + gap
    const fitsAbove = above >= viewportTop + margin
    const fitsBelow = below + height <= viewportBottom - margin
    const y = fitsBelow && (preferBelow || !fitsAbove) ? below : above
    button.style.left = `${Math.max(viewportLeft + margin, Math.min(left - width / 2, viewportRight - width - margin))}px`
    button.style.top = `${Math.max(viewportTop + margin, y)}px`
  }, [position, label])

  if (!visible || !position || !surfaceId) return null

  return createPortal(
    <button
      className="browser-quote-selection"
      ref={buttonRef}
      type="button"
      onMouseDown={event => event.preventDefault()}
      onClick={() => {
        const content = contentRef.current
        const selected = content && readSelection(content)
        if (!content || !selected) return

        const quote = selected.text.split('\n').map(line => line ? `> ${line}` : '>').join('\n')
        // The editor uses the last break to keep the trailing blank line editable.
        if (composers.get(surfaceId)?.(`${quote}\n\n\n`) && readSelection(content)) {
          selected.selection.removeAllRanges()
        }
        setPosition(null)
      }}
    >
      <span>{label}</span>
    </button>,
    document.body
  )
}
