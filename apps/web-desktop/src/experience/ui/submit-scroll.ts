import { useLayoutEffect, type RefObject } from 'react'
import { subscribeBrowserAcceptedSubmit, type BrowserAcceptedSubmit } from './accepted-submit'

const USER_MESSAGE = '[data-slot="aui_user-message-root"]'
const TURN = '[data-slot="aui_turn-pair"]'
const TOP_GAP_PX = 12

function latestUserMessage(viewport: HTMLElement): HTMLElement | null {
  const messages = viewport.querySelectorAll<HTMLElement>(USER_MESSAGE)
  return messages.item(messages.length - 1) ?? null
}

function viewportScale(viewport: HTMLElement): number {
  return viewport.getBoundingClientRect().height / viewport.offsetHeight || 1
}

function reserveResponseSpace(viewport: HTMLElement, content: HTMLElement, prompt: HTMLElement) {
  const initialTurn = prompt.closest<HTMLElement>(TURN)
  if (!initialTurn) return null

  let turn = initialTurn
  let previousMinHeight = turn.style.minHeight
  const promptText = (element: HTMLElement) => (element.querySelector('[data-slot="aui_user-message-text"]') ?? element).textContent
  const submittedText = promptText(prompt)
  const resize = () => {
    if (!turn.isConnected || viewport.clientHeight === 0) return
    const scale = viewportScale(viewport)
    const tail = content.lastElementChild
    if (!tail) return

    // Measure actual trailing elements (including composer clearance). The
    // content's min-height can include unused space in a short conversation.
    const trailingHeight = Math.max(0, (tail.getBoundingClientRect().bottom - turn.getBoundingClientRect().bottom) / scale)
      + (Number.parseFloat(getComputedStyle(content).paddingBottom) || 0)
    const minimum = `${Math.max(0, Math.ceil(viewport.clientHeight - TOP_GAP_PX - trailingHeight))}px`
    if (turn.style.minHeight !== minimum) turn.style.minHeight = minimum
  }
  const sizes = new ResizeObserver(resize)
  const changes = new MutationObserver(() => {
    if (!viewport.isConnected) { dispose(); return }
    const latest = latestUserMessage(viewport)
    if (!latest || latest === prompt) return

    // The runtime can replace optimistic message IDs and DOM on completion.
    // Carry the reservation over that reconciliation within the same chat.
    const sameMessage = latest.dataset.messageId && latest.dataset.messageId === prompt.dataset.messageId
    if (!sameMessage && (prompt.isConnected || promptText(latest) !== submittedText)) {
      dispose()
      return
    }
    const nextTurn = latest.closest<HTMLElement>(TURN)
    if (!nextTurn) return
    const following = viewport.getAttribute('data-following') === 'true'
    turn.style.minHeight = previousMinHeight
    prompt = latest
    turn = nextTurn
    previousMinHeight = turn.style.minHeight
    resize()
    // Removing the old turn can clamp scrollTop before the replacement is
    // measured, even if the final content height is unchanged (no RO event).
    if (following) viewport.scrollTop = viewport.scrollHeight - viewport.clientHeight
  })
  const dispose = () => {
    sizes.disconnect()
    changes.disconnect()
    turn.style.minHeight = previousMinHeight
  }

  // Minimum height leaves the reply at the top and lets it consume the empty
  // space naturally. Keep it after short replies to avoid a completion jump.
  resize()
  sizes.observe(viewport)
  sizes.observe(content)
  changes.observe(content, { childList: true, subtree: true })

  return {
    dispose,
    align() {
      if (!prompt.isConnected) return
      resize()
      // The prompt is sticky; its containing turn gives its natural position.
      const delta = (turn.getBoundingClientRect().top - viewport.getBoundingClientRect().top) / viewportScale(viewport)
      viewport.scrollTop = Math.max(0, viewport.scrollTop + delta - TOP_GAP_PX)
    }
  }
}

/** Keep a submitted prompt and the start of its response together in view. */
function installConversationSubmitScroll(surfaceId: string, viewport: HTMLElement, content: HTMLElement): () => void {
  const mobileViewport = window.matchMedia('(width < 48rem)')
  let firstFrame = 0
  let secondFrame = 0
  let space: ReturnType<typeof reserveResponseSpace> = null

  const clearPending = () => {
    window.cancelAnimationFrame(firstFrame)
    window.cancelAnimationFrame(secondFrame)
  }

  const onSubmitAccepted = (detail: BrowserAcceptedSubmit) => {
    if (mobileViewport.matches) {
      clearPending()
      space?.dispose()
      space = null
      return
    }

    if (!viewport.isConnected || !viewport.getClientRects().length) return
    const prompt = latestUserMessage(viewport)
    if (!prompt || (prompt.querySelector('[data-slot="aui_user-message-text"]') ?? prompt).textContent !== detail.text) return

    clearPending()
    space?.dispose()
    space = reserveResponseSpace(viewport, content, prompt)
    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        if (!mobileViewport.matches && viewport.isConnected && prompt.isConnected) space?.align()
      })
    })
  }
  const onViewportModeChange = () => {
    if (!mobileViewport.matches) return
    clearPending()
    space?.dispose()
    space = null
  }

  const unsubscribe = subscribeBrowserAcceptedSubmit(surfaceId, onSubmitAccepted)
  mobileViewport.addEventListener('change', onViewportModeChange)
  return () => {
    unsubscribe()
    mobileViewport.removeEventListener('change', onViewportModeChange)
    clearPending()
    space?.dispose()
  }
}

/** The engine owns surface identity, selection lifetime and both transcript refs. */
export function useBrowserSubmitScroll({ surfaceId, sessionKey, profile, visible, scrollRef, contentRef }: {
  surfaceId: string | null
  sessionKey?: string | null
  profile?: string
  visible: boolean
  scrollRef: RefObject<HTMLElement | null>
  contentRef: RefObject<HTMLElement | null>
}): void {
  useLayoutEffect(() => {
    if (!visible || !surfaceId || !scrollRef.current || !contentRef.current) return
    return installConversationSubmitScroll(surfaceId, scrollRef.current, contentRef.current)
  }, [surfaceId, sessionKey, profile, visible, scrollRef, contentRef])
}
