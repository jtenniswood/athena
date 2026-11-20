export interface BrowserProfile {
  key: string
  label: string
  botName: string
  appearance: { color: string | null; image: string | null; shape: string }
}

export interface BrowserProfiles {
  active: string
  all: boolean
  items: readonly BrowserProfile[]
  fallback: BrowserProfile | null
}

export interface BrowserNewChatProfile {
  profile: string
  editable: boolean
  select(profile: string): void
}
