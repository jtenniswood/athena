import { useSyncExternalStore } from 'react'

export type FollowupBehavior = 'queue' | 'steer'

const KEY = 'hermes-web.browser.followup-behavior'
const CHANGE_EVENT = 'hermes-web:followup-behavior-change'

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

/** Resolve a submission intent without inspecting buttons or intercepting events. */
export function browserFollowupMode(alternate = false): FollowupBehavior {
  const preferred = readFollowupBehavior()
  return alternate ? preferred === 'queue' ? 'steer' : 'queue' : preferred
}
