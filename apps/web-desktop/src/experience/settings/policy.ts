import {
  hiddenSettingsPages,
  hiddenPageDefinitions,
  settingsCatalog,
  settingsFields,
  settingsGroups,
  settingsPageAliases,
  settingsPageId,
  settingsPageIsVisible,
  isDesktopStartupSettingsPage,
  settingsPageLabel,
  settingsPolicy,
  settingsScopeDescription,
  settingsFieldIsVisible,
  isEverydaySettingsField,
  validateSettingsCatalog
} from './catalog'

export {
  hiddenSettingsPages,
  hiddenPageDefinitions,
  settingsCapabilities,
  settingsCatalog,
  settingsFields,
  settingsGroups,
  settingsPageAliases,
  settingsPageDefinition,
  settingsPageId,
  settingsPageIsVisible,
  isDesktopStartupSettingsPage,
  settingsPageLabel,
  settingsPolicy,
  settingsScopeDescription,
  settingsCapability,
  settingsFieldIsVisible,
  isEverydaySettingsField,
  validateSettingsCatalog
} from './catalog'
export type {
  SettingsCapability,
  SettingsCapabilityState,
  SettingsFieldDefinition,
  SettingsGroupDefinition,
  SettingsPageDefinition,
  SettingsScope
} from './catalog'

export function isSettingsSectionVisible(id: string): boolean {
  return settingsPageIsVisible(id)
}

export function orderSettingsSections<T extends { id: string }>(sections: readonly T[]): T[] {
  const order = settingsPolicy.sections.order
  return sections
    .filter(section => isSettingsSectionVisible(section.id)
      && !isDesktopStartupSettingsPage(`${section.id} ${'label' in section ? String(section.label) : ''}`))
    .map((section, index) => ({ section, index }))
    .sort((a, b) => {
      const aRank = order.indexOf(settingsPageId(a.section.id))
      const bRank = order.indexOf(settingsPageId(b.section.id))
      if (aRank < 0 && bRank < 0) return a.index - b.index
      if (aRank < 0) return 1
      if (bRank < 0) return -1
      return aRank - bRank || a.index - b.index
    })
    .map(({ section }) => section)
}

export function groupSettingsSections<T extends { id: string; label: string }>(sections: readonly T[]) {
  const visible = orderSettingsSections(sections).map(section => ({ ...section, label: settingsPageLabel(section.id, section.label) }))
  const known = new Set(settingsCatalog.flatMap(group => group.pages.map(page => page.id)))
  return [
    ...settingsCatalog.map(group => ({
      id: group.id,
      label: group.title,
      pages: group.pages.map(page => page.id),
      items: visible.filter(item => group.pages.some(page => page.id === settingsPageId(item.id)))
    })),
    { id: 'other', label: 'Other Settings', pages: [], items: visible.filter(item => !known.has(settingsPageId(item.id))) }
  ].filter(group => group.items.length > 0)
}

/** Reuse upstream search actions and retain the old names as searchable aliases. */
export function presentSettingsPalette<T extends { id: string; label: string; keywords?: string[] }>(
  items: T[], createPage: (id: string, label: string) => T
): T[] {
  const tabFor = (id: string) => id.replace(/^(?:sp|set)-/, '').replace(/^config-/, 'config:')
  const pages = new Set(items.map(item => settingsPageId(tabFor(item.id))))
  const additional = settingsGroups.flatMap(group => group.pages)
    .filter(id => !pages.has(id))
    .map(id => createPage(id, settingsPageLabel(id, id)))
  return orderSettingsSections([...items, ...additional].map(item => {
    const tab = tabFor(item.id)
    const page = settingsPageId(tab)
    const params = new URLSearchParams(tab)
    const child = params.get('kview') ? `kview:${params.get('kview')}` : null
    const parentLabel = settingsPageLabel(page, item.label)
    const label = child ? `${parentLabel} — ${settingsPageLabel(child, item.label)}`
      : params.has('pview') ? `${parentLabel} — ${item.label}` : parentLabel
    return {
      id: tab,
      item: { ...item, label, keywords: [...(item.keywords ?? []), item.label, ...settingsPageAliases(page)] }
    }
  })).map(({ item }) => item)
}

export function presentSettingsSearchEntry<T extends { context: string; keywords: string[]; target: { view: string; keysView?: string } }>(entry: T): T {
  const page = entry.target.view
  const label = settingsPageLabel(page, entry.context)
  const context = entry.target.keysView
    ? `${label} — ${settingsPageLabel(`kview:${entry.target.keysView}`, entry.context)}` : label
  return { ...entry, context, keywords: [...entry.keywords, entry.context, ...settingsPageAliases(page)] }
}

export function isSettingsFieldVisible(key: string): boolean {
  return settingsFieldIsVisible(key)
}
