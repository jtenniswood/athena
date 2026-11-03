import type { SettingsControl, SettingsDescriptor, SettingsFrameDescriptor, SettingsRow } from '../experience/contracts/settings-presentation'

const sections = new WeakMap<HTMLElement, SettingsDescriptor>()
const frames = new WeakMap<HTMLElement, () => SettingsFrameDescriptor>()
const listeners = new Set<() => void>()
let nextOwner = 0

export function settingsPresentationChanged(): void { for (const listener of listeners) listener() }
export function subscribeSettingsPresentation(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function settingsDescriptor(element: HTMLElement): SettingsDescriptor | undefined { return sections.get(element) }
export function settingsFrameDescriptor(element: HTMLElement): SettingsFrameDescriptor | undefined { return frames.get(element)?.() }

export function registerSettingsDescriptor(element: HTMLElement, descriptor: SettingsDescriptor): () => void {
  sections.set(element, descriptor)
  settingsPresentationChanged()
  return () => {
    if (sections.get(element) === descriptor) { sections.delete(element); settingsPresentationChanged() }
  }
}
export function registerSettingsFrame(element: HTMLElement, snapshot: () => SettingsFrameDescriptor): () => void {
  frames.set(element, snapshot)
  settingsPresentationChanged()
  return () => {
    if (frames.get(element) === snapshot) { frames.delete(element); settingsPresentationChanged() }
  }
}

/** Stable field identities within one mounted owner, with no copied setting values. */
export function createSettingsDescriptor(read: () => readonly SettingsControl[]): SettingsDescriptor {
  const prefix = `setting-${++nextOwner}:`
  const ids = new Map<string, string>()
  const token = (name: string) => {
    if (!ids.has(name)) ids.set(name, prefix + ids.size)
    return ids.get(name)!
  }
  const controlToken = (row: SettingsControl) => token(JSON.stringify(['control', row.id, row.kind, row.inputType ?? '']))
  const controls = () => {
    const rows = read(), names = new Set<string>()
    if (rows.length > 1000) throw new Error('Settings presentation is too large')
    for (const row of rows) {
      if (typeof row.label !== 'string' || !row.label || row.label.length > 2000 || (row.description?.length ?? 0) > 1000 ||
          (row.value?.length ?? 0) > 131072 || (row.options?.length ?? 0) > 2000 ||
          row.options?.some(option => option.label.length > 240 || option.value.length > 1000) ||
          (row.run && (!row.id || row.id.length > 2000)) || (row.id && names.has(row.id))) {
        throw new Error('Unsupported settings presentation')
      }
      if (row.id) names.add(row.id)
    }
    return rows
  }
  return {
    snapshot() {
      return controls().map(control => {
        const { id, kind, label, description, presentation, group, icon, value, inputType, checked, disabled, options } = control
        const row: SettingsRow = { id: id ? controlToken(control) : undefined, kind, label, description, presentation,
          group: group ? token(JSON.stringify(['group', group])) : undefined, icon, inputType, checked, disabled,
          options: options?.map(({ label, value, disabled }) => ({ label, value, disabled })),
          value: inputType === 'password' ? undefined : value }
        return row
      })
    },
    async invoke(id, value) {
      if (!id.startsWith(prefix)) return
      const control = controls().find(row => row.id && controlToken(row) === id)
      if (!control?.run || control.disabled || ['heading', 'text'].includes(control.kind)) return
      if (['input', 'select'].includes(control.kind)) {
        if (typeof value !== 'string' || value.length > 131072) return
        if (control.kind === 'select' && !control.options?.some(option => option.value === value && !option.disabled)) return
      }
      await control.run(value)
    }
  }
}
