export const preferenceKeys: string[]
export const MAX_PREFERENCE_BYTES: number
export function isPreferenceKey(key: string): boolean
export function validatePreferenceValues(values: unknown): Record<string, string | null>
