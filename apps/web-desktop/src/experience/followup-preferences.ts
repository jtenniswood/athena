import { browserPreference, useBrowserPreference } from '../platform/preferences'
export type { FollowupBehavior } from '../../../../scripts/browser-preference-contract.mjs'
import type { FollowupBehavior } from '../../../../scripts/browser-preference-contract.mjs'

export const readFollowupBehavior = (): FollowupBehavior => browserPreference('followupBehavior').read()
export const writeFollowupBehavior = (value: FollowupBehavior): void => browserPreference('followupBehavior').write(value)
export const useFollowupBehavior = (): FollowupBehavior => useBrowserPreference('followupBehavior')

/** Resolve a submission intent without inspecting buttons or intercepting events. */
export function browserFollowupMode(alternate = false): FollowupBehavior {
  const preferred = readFollowupBehavior()
  return alternate ? preferred === 'queue' ? 'steer' : 'queue' : preferred
}
