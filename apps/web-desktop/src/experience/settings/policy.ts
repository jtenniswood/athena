/** Local presentation overrides. Unlisted settings inherit upstream behavior. */
export const settingsGroups = [
  { id: 'preferences', label: 'Preferences', pages: ['config:appearance', 'notifications', 'keybinds'] },
  { id: 'assistant', label: 'Assistant', pages: ['config:model', 'providers', 'config:chat', 'config:voice', 'config:memory'] },
  { id: 'tools', label: 'Tools', pages: ['config:workspace', 'config:browser', 'config:safety', 'vault', 'keys'] },
  { id: 'service', label: 'Service', pages: ['gateway', 'billing'] },
  { id: 'maintenance', label: 'Maintenance', pages: ['sessions', 'config:browser-configuration', 'config:advanced'] }
]

const pageLabels: Record<string, string> = {
  'config:appearance': 'Appearance',
  notifications: 'Notifications',
  keybinds: 'Keyboard Shortcuts',
  'config:model': 'Models',
  providers: 'AI Connections',
  'config:chat': 'Chat',
  'config:voice': 'Voice',
  'config:memory': 'Memory',
  'config:workspace': 'Workspace',
  'config:browser': 'Browser Automation',
  'config:safety': 'Permissions',
  vault: 'Saved Logins',
  keys: 'Credentials',
  gateway: 'Server Connection',
  billing: 'Billing',
  sessions: 'Archived Chats',
  'config:browser-configuration': 'Configuration',
  'config:advanced': 'Advanced',
  'kview:tools': 'Tool API Keys',
  'kview:settings': 'Server Credentials'
}

const pageAliases: Record<string, string[]> = {
  'config:memory': ['Memory & context'],
  'config:workspace': ['Workspace & files'],
  'config:safety': ['Permissions & safety'],
  billing: ['Usage & billing'],
  providers: ['Providers', 'accounts', 'API keys', 'endpoints'],
  vault: ['Passwords & Logins', 'vault'],
  keys: ['Tools & Keys', 'Tool & service credentials'],
  gateway: ['Gateways', 'gateway', 'sign in'],
  'config:browser-configuration': ['Backup & reset', 'backup', 'import', 'export', 'reset']
}

export const settingsPolicy = {
  sections: {
    // Keep upstream ids stable for deep links and automatically inherited pages.
    hidden: ['about'] as string[],
    order: settingsGroups.flatMap(group => group.pages)
  },
  fields: {
    // Use config schema keys, stable appearance IDs, or supported custom controls.
    hidden: [
      // These values remain in the remote configuration but have no working
      // control in the browser deployment, or require host capability data we
      // do not receive from the configured gateway.
      'appearance.app-actions',
      'appearance.translucency',
      'browser.use_real_profile',
      'terminal.font_family',
      'updates.non_interactive_local_changes',
      'voice.client_direct',
      'voice.record_key'
    ] as string[]
  }
} as const

function settingsPageId(id: string): string {
  return id.split('&')[0]
}

export function settingsPageLabel(id: string, fallback: string): string {
  return pageLabels[settingsPageId(id)] ?? fallback
}

export function isSettingsSectionVisible(id: string): boolean {
  const page = settingsPageId(id)
  const canonical = page.startsWith('config:') ? page.slice('config:'.length) : page
  return !settingsPolicy.sections.hidden.includes(page) && !settingsPolicy.sections.hidden.includes(canonical)
}

export function orderSettingsSections<T extends { id: string }>(sections: readonly T[]): T[] {
  const order = settingsPolicy.sections.order
  return sections
    .filter(section => isSettingsSectionVisible(section.id))
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
  const known = new Set(settingsGroups.flatMap(group => group.pages))
  return [
    ...settingsGroups.map(group => ({ ...group, items: visible.filter(item => group.pages.includes(item.id)) })),
    { id: 'other', label: 'Other Settings', items: visible.filter(item => !known.has(item.id)) }
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
      item: { ...item, label, keywords: [...(item.keywords ?? []), item.label, ...(pageAliases[page] ?? [])] }
    }
  })).map(({ item }) => item)
}

export function presentSettingsSearchEntry<T extends { context: string; keywords: string[]; target: { view: string; keysView?: string } }>(entry: T): T {
  const page = entry.target.view
  const label = settingsPageLabel(page, entry.context)
  const context = entry.target.keysView
    ? `${label} — ${settingsPageLabel(`kview:${entry.target.keysView}`, entry.context)}` : label
  return { ...entry, context, keywords: [...entry.keywords, entry.context, ...(pageAliases[page] ?? [])] }
}

export function isSettingsFieldVisible(key: string): boolean {
  return !(settingsPolicy.fields.hidden as readonly string[]).includes(key)
}
