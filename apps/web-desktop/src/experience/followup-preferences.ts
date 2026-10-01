import { useSyncExternalStore } from 'react'

export type FollowupBehavior = 'queue' | 'steer'

const KEY = 'hermes-web.browser.followup-behavior'
const CHANGE_EVENT = 'hermes-web:followup-behavior-change'

function queueButton(composer: Element): HTMLButtonElement | null {
  return [...composer.querySelectorAll<HTMLButtonElement>('button[data-browser-composer-action]')]
    .find(button => button.querySelector('svg.lucide-layers-3')) ?? null
}

export function readFollowupBehavior(): FollowupBehavior {
  try {
    return window.localStorage.getItem(KEY) === 'steer' ? 'steer' : 'queue'
  } catch {
    return 'queue'
  }
}

export function writeFollowupBehavior(value: FollowupBehavior): void {
  try {
    window.localStorage.setItem(KEY, value)
  } catch {
    // The setting is optional when browser storage is unavailable.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange)
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange)
    window.removeEventListener('storage', onChange)
  }
}

export function useFollowupBehavior(): FollowupBehavior {
  return useSyncExternalStore(subscribe, readFollowupBehavior, () => 'queue')
}

/** Route Enter through the existing composer controls when Queue is the default. */
export function installFollowupBehavior(): () => void {
  const onClick = (event: MouseEvent) => {
    if (readFollowupBehavior() !== 'queue' || !event.isTrusted) return
    const target = event.target
    if (!(target instanceof Element)) return
    const send = target.closest<HTMLButtonElement>('[data-browser-send-action]')
    const composer = send?.closest('[data-slot="composer-dock"]')
    const queue = composer ? queueButton(composer) : null
    if (!send || !queue) return
    event.preventDefault()
    event.stopImmediatePropagation()
    queue.click()
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (readFollowupBehavior() !== 'queue' || event.key !== 'Enter' || event.shiftKey || event.isComposing) return
    const target = event.target
    if (!(target instanceof Element)) return
    const composer = target.closest('[data-slot="composer-dock"]')
    if (!composer) return
    const queue = queueButton(composer)
    const steer = composer.querySelector<HTMLButtonElement>('[data-browser-send-action]')
    if (!queue || !steer) return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (event.metaKey || event.ctrlKey) steer.click()
    else queue.click()
  }

  document.addEventListener('click', onClick, true)
  document.addEventListener('keydown', onKeyDown, true)
  return () => {
    document.removeEventListener('click', onClick, true)
    document.removeEventListener('keydown', onKeyDown, true)
  }
}
