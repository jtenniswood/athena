export interface BrowserProfile {
  key: string
  label: string
  botName: string
  appearance: { color: string | null; image: string | null; shape: string }
}

export interface BrowserProfiles {
  active: string
  all: boolean
  defaultNewSessionProfile: string | null
  items: readonly BrowserProfile[]
  fallback: BrowserProfile | null
  select(profile: string | null): void
  setDefaultNewSessionProfile(profile: string | null): void
  reorder(source: string, target: string, after: boolean): void
}
