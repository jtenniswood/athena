/** Serializable presentation shared by the web owners and the Android host. */
export interface SettingsRow {
  id?: string
  kind: 'heading' | 'text' | 'action' | 'toggle' | 'radio' | 'input' | 'select'
  label: string
  description?: string
  presentation?: 'navigation' | 'choice' | 'primary' | 'destructive' | 'secondary' | 'value'
  group?: string
  icon?: string
  value?: string
  inputType?: string
  checked?: boolean
  disabled?: boolean
  options?: { label: string; value: string; disabled?: boolean }[]
}

/** Commands call the original value/save owner; they are never sent over the bridge. */
export interface SettingsControl extends SettingsRow {
  run?(value?: unknown): void | Promise<unknown>
}

export interface SettingsDescriptor {
  snapshot(): SettingsRow[]
  invoke(id: string, value?: unknown): Promise<void>
}

export interface SettingsFrameDescriptor {
  scope: string
  title: string
  close(): void
  back(): void
  search?: { label: string; run(): void }
}
