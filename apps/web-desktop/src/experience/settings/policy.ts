/** Local presentation overrides. Unlisted settings inherit upstream behavior. */
export const settingsPolicy = {
  sections: {
    // Section ids are upstream section ids such as `model`, or page ids such
    // as `config:model` and `keybinds` when hiding non-config pages.
    hidden: [] as string[],
    order: [] as string[]
  },
  fields: {
    // Use config schema keys or stable appearance ids such as
    // `display.show_reasoning` and `appearance.theme`.
    hidden: [] as string[]
  }
} as const

export function isSettingsSectionVisible(id: string): boolean {
  const canonical = id.startsWith('config:') ? id.slice('config:'.length) : id
  return !settingsPolicy.sections.hidden.includes(id) && !settingsPolicy.sections.hidden.includes(canonical)
}

export function orderSettingsSections<T extends { id: string }>(sections: readonly T[]): T[] {
  const order = settingsPolicy.sections.order
  return sections
    .filter(section => isSettingsSectionVisible(section.id))
    .map((section, index) => ({ section, index }))
    .sort((a, b) => {
      const aRank = order.indexOf(a.section.id)
      const bRank = order.indexOf(b.section.id)
      if (aRank < 0 && bRank < 0) return a.index - b.index
      if (aRank < 0) return 1
      if (bRank < 0) return -1
      return aRank - bRank || a.index - b.index
    })
    .map(({ section }) => section)
}

export function isSettingsFieldVisible(key: string): boolean {
  return !(settingsPolicy.fields.hidden as readonly string[]).includes(key)
}
