/**
 * Browser settings presentation metadata.
 *
 * The renderer remains the source of setting schemas and values. This catalog
 * only describes how the wrapper presents upstream pages and controls.
 */
export type SettingsCapabilityState = 'supported' | 'unsupported' | 'unknown'
export type SettingsScope = 'browser' | 'connected-server' | 'connection' | 'mixed'

export type SettingsCapability = {
  id: string
  state: SettingsCapabilityState
  evidence: string
}

export type SettingsPageDefinition = {
  id: string
  title: string
  aliases?: readonly string[]
  scope?: SettingsScope
  scopeDescription?: string
  capability?: string
  visibility?: 'visible' | 'hidden'
  children?: readonly SettingsPageDefinition[]
}

export type SettingsGroupDefinition = {
  id: string
  title: string
  pages: readonly SettingsPageDefinition[]
}

export type SettingsFieldDefinition = {
  id: string
  visibility: 'visible' | 'hidden'
  reason?: string
  capability?: string
  supportState?: SettingsCapabilityState
}

/**
 * Unknown server capabilities stay visible. The web bridge does not currently
 * provide a general capability manifest, so absence of evidence is not treated
 * as evidence that an upstream option is unsupported.
 */
export const settingsCapabilities: readonly SettingsCapability[] = [
  {
    id: 'server.real-browser-profile',
    state: 'unknown',
    evidence: 'The browser settings bridge does not advertise whether the connected Hermes host has a supported Chromium profile.'
  }
]

export const settingsCatalog: readonly SettingsGroupDefinition[] = [
  {
    id: 'preferences',
    title: 'Preferences',
    pages: [
      { id: 'config:appearance', title: 'Appearance', scope: 'mixed' },
      { id: 'notifications', title: 'Notifications', scope: 'browser' },
      { id: 'keybinds', title: 'Keyboard Shortcuts', scope: 'browser' }
    ]
  },
  {
    id: 'assistant',
    title: 'Assistant',
    pages: [
      { id: 'config:model', title: 'Models', scope: 'connected-server' },
      { id: 'providers', title: 'AI Connections', aliases: ['Providers', 'accounts', 'API keys', 'endpoints'], scope: 'connected-server' },
      { id: 'config:chat', title: 'Chat', scope: 'mixed' },
      { id: 'config:voice', title: 'Voice', scope: 'mixed' },
      { id: 'config:memory', title: 'Memory', aliases: ['Memory & context'], scope: 'connected-server' }
    ]
  },
  {
    id: 'tools',
    title: 'Tools',
    pages: [
      { id: 'config:workspace', title: 'Workspace', aliases: ['Workspace & files'], scope: 'connected-server' },
      {
        id: 'config:browser', title: 'Browser Automation', scope: 'connected-server', visibility: 'hidden',
        capability: 'server.real-browser-profile',
        scopeDescription: 'Browser automation runs on the connected Hermes server. “Use My Real Browser Profile” uses that server’s supported Chromium profile, not the browser viewing this page. Private URLs and local network access refer to networks visible from that server.'
      },
      { id: 'config:safety', title: 'Permissions', aliases: ['Permissions & safety'], scope: 'connected-server' },
      {
        id: 'vault', title: 'Saved Logins', aliases: ['Passwords & Logins'], scope: 'connected-server', visibility: 'hidden',
        scopeDescription: 'Saved logins are stored and used by the connected Hermes server for browser automation.'
      },
      {
        id: 'keys', title: 'Credentials', aliases: ['Tools & Keys', 'Tool & service credentials'], scope: 'connected-server',
        children: [
          { id: 'kview:tools', title: 'Tool API Keys' },
          { id: 'kview:settings', title: 'Server Credentials' }
        ]
      }
    ]
  },
  {
    id: 'service',
    title: 'Service',
    pages: [
      { id: 'gateway', title: 'Server Connection', aliases: ['Gateways', 'gateway', 'sign in'], scope: 'connection' },
      {
        id: 'billing', title: 'Billing', aliases: ['Usage & billing'], scope: 'connected-server',
        scopeDescription: 'This page shows billing from the connected Hermes server, such as Nous usage. It does not include external model provider or web hosting charges.'
      }
    ]
  },
  {
    id: 'maintenance',
    title: 'Maintenance',
    pages: [
      { id: 'sessions', title: 'Archived Chats', scope: 'connected-server' },
      {
        id: 'config:browser-configuration', title: 'Configuration',
        aliases: ['Backup & reset', 'backup', 'import', 'export', 'reset'], scope: 'connected-server'
      },
      { id: 'config:advanced', title: 'Advanced', scope: 'mixed' }
    ]
  }
]

/** Local visibility choices never delete upstream configuration values. */
export const settingsFields: readonly SettingsFieldDefinition[] = [
  { id: 'appearance.backdrop', visibility: 'hidden', reason: 'Hidden from browser settings.' },
  { id: 'appearance.intro-splash', visibility: 'hidden', reason: 'Hidden from browser settings.' },
  { id: 'appearance.resume-last-session', visibility: 'hidden', reason: 'Hidden from browser settings.' },
  { id: 'appearance.tips', visibility: 'hidden', reason: 'Hidden from browser settings.' },
  { id: 'appearance.tours', visibility: 'hidden', reason: 'Hidden from browser settings.' },
  { id: 'appearance.chat-font', visibility: 'hidden', reason: 'Hidden from browser settings.' },
  { id: 'appearance.composer-popout', visibility: 'hidden', reason: 'Hidden from browser settings.' },
  { id: 'appearance.theme', visibility: 'hidden', reason: 'Theme selection is provided by the browser Colour themes page.' },
  { id: 'appearance.app-actions', visibility: 'hidden', supportState: 'unsupported', reason: 'The web toolbar owns its fixed action layout.' },
  { id: 'appearance.translucency', visibility: 'hidden', supportState: 'unsupported', reason: 'Window translucency requires native window support.' },
  { id: 'terminal.font_family', visibility: 'hidden', supportState: 'unsupported', reason: 'This browser interface has no native terminal pane.' },
  { id: 'updates.non_interactive_local_changes', visibility: 'hidden', supportState: 'unknown', reason: 'This host update control is not exposed as a browser preference.' },
  { id: 'voice.client_direct', visibility: 'hidden', supportState: 'unknown', reason: 'Direct provider voice has not been verified for this browser-to-Hermes connection.' },
  { id: 'voice.record_key', visibility: 'hidden', supportState: 'unsupported', reason: 'The terminal voice shortcut is separate from browser keyboard shortcuts.' },
  { id: 'voice.voice_chat_mode', visibility: 'hidden', reason: 'Voice conversation is not available in this browser interface.' },
  { id: 'voice.gpt_live.voice', visibility: 'hidden', reason: 'Voice conversation is not available in this browser interface.' },
  { id: 'voice.gpt_live.instructions', visibility: 'hidden', reason: 'Voice conversation is not available in this browser interface.' }
]

export const hiddenPageDefinitions: readonly SettingsPageDefinition[] = [
  { id: 'about', title: 'About', visibility: 'hidden' },
  { id: 'pets', title: 'Pets', visibility: 'hidden' },
  { id: 'hud', title: 'HUD', visibility: 'hidden' },
  { id: 'screen-capture', title: 'Screen Capture', visibility: 'hidden' },
  { id: 'appearance:pet', title: 'Appearance pet settings', visibility: 'hidden' },
  { id: 'keybinds:shortcuts', title: 'Keyboard shortcuts section', visibility: 'hidden' },
  { id: 'keybinds:hud-gesture', title: 'HUD gesture', visibility: 'hidden' },
  { id: 'keybinds:screen-capture', title: 'Screen capture settings', visibility: 'hidden' },
  { id: 'model:fallbacks', title: 'Fallback models', visibility: 'hidden' },
  { id: 'gateway:connection', title: 'Gateway connection', visibility: 'hidden' },
  { id: 'gateway:devices', title: 'Gateway devices', visibility: 'hidden' },
  { id: 'gateway:managed-updates', title: 'Gateway managed updates', visibility: 'hidden' },
  { id: 'sessions:archived', title: 'Archived chats', visibility: 'hidden' },
  { id: 'sessions:default-directory', title: 'Default project folder', visibility: 'hidden' }
]
export const hiddenSettingsPages = hiddenPageDefinitions.map(page => page.id)

const pageDefinitions = settingsCatalog.flatMap(group => group.pages.flatMap(page => [page, ...(page.children ?? [])]))
const pagesById = new Map<string, SettingsPageDefinition>([...pageDefinitions, ...hiddenPageDefinitions].map(page => [page.id, page] as const))
const capabilitiesById = new Map<string, SettingsCapability>(settingsCapabilities.map(capability => [capability.id, capability] as const))

export function settingsPageId(id: string): string {
  return id.split('&')[0]
}

export function isDesktopStartupSettingsPage(idOrLabel: string): boolean {
  const normalized = idOrLabel.toLowerCase().replace(/[^a-z0-9]+/g, ' ')
  return normalized.includes('desktop') && normalized.includes('startup')
}

export function settingsPageDefinition(id: string): SettingsPageDefinition | undefined {
  return pagesById.get(settingsPageId(id))
}

export function settingsPageLabel(id: string, fallback: string): string {
  return settingsPageDefinition(id)?.title ?? fallback
}

export function settingsPageAliases(id: string): readonly string[] {
  return settingsPageDefinition(id)?.aliases ?? []
}

export function settingsScopeDescription(id: string): string | undefined {
  return settingsPageDefinition(id)?.scopeDescription
}

export function settingsCapability(id: string): SettingsCapability | undefined {
  return capabilitiesById.get(id)
}

export function settingsPageIsVisible(id: string): boolean {
  const page = settingsPageId(id)
  const canonical = page.startsWith('config:') ? page.slice('config:'.length) : page
  return !isDesktopStartupSettingsPage(page)
    && settingsPageDefinition(page)?.visibility !== 'hidden'
    && !hiddenSettingsPages.includes(page)
    && !hiddenSettingsPages.includes(canonical)
}

export function settingsFieldIsVisible(id: string): boolean {
  if (settingsFields.find(field => field.id === id)?.visibility === 'hidden') return false
  return !(settingsPolicy.fields.hidden as readonly string[]).includes(id)
}

/** Keep the everyday configuration surface small; new upstream fields default to advanced. */
const everydaySettingsFields: Readonly<Record<string, readonly string[]>> = {
  chat: ['display.personality', 'timezone', 'display.show_reasoning'],
  model: ['fallback_providers', 'fallback_models', 'models.fallback', 'model.fallback'],
  memory: ['memory.memory_enabled', 'memory.user_profile_enabled'],
  safety: ['approvals.mode'],
  voice: ['stt.enabled', 'voice.auto_tts'],
  advanced: [
    'agent.max_turns',
    'delegation.max_iterations',
    'delegation.max_concurrent_children',
    'delegation.child_timeout_seconds'
  ],
  workspace: ['terminal.cwd', 'desktop.repo_scan_enabled']
}

export function isEverydaySettingsField(sectionId: string, fieldId: string): boolean {
  return everydaySettingsFields[sectionId]?.includes(fieldId) ?? false
}

/** Validate authored entries while leaving unknown upstream pages to fallback. */
export function validateSettingsCatalog(): string[] {
  const errors: string[] = []
  const groupIds = new Set<string>()
  const destinationIds = new Set<string>()
  const aliases = new Map<string, string>()

  for (const group of settingsCatalog) {
    if (groupIds.has(group.id)) errors.push(`Duplicate settings group: ${group.id}`)
    groupIds.add(group.id)
    for (const page of group.pages) {
      for (const entry of [page, ...(page.children ?? [])]) {
        if (destinationIds.has(entry.id)) errors.push(`Duplicate settings destination: ${entry.id}`)
        destinationIds.add(entry.id)
        for (const alias of [entry.title, ...(entry.aliases ?? [])]) {
          const key = alias.trim().toLocaleLowerCase()
          const previous = aliases.get(key)
          if (previous && previous !== entry.id) errors.push(`Ambiguous settings alias “${alias}”: ${previous} and ${entry.id}`)
          aliases.set(key, entry.id)
        }
      }
    }
  }
  for (const page of hiddenPageDefinitions) {
    if (destinationIds.has(page.id)) errors.push(`Duplicate settings destination: ${page.id}`)
    destinationIds.add(page.id)
  }
  return errors
}

/**
 * The catalog is the only source of section order, titles, groups and aliases.
 * Keep this derived view for callers that need simple navigation data.
 */
export const settingsGroups = settingsCatalog.map(group => ({
  id: group.id,
  label: group.title,
  pages: group.pages.map(page => page.id)
}))

/** Compatibility view for wrapper callers while they migrate to catalog APIs. */
export const settingsPolicy = {
  sections: {
    hidden: hiddenSettingsPages,
    order: settingsGroups.flatMap(group => group.pages)
  },
  fields: {
    hidden: settingsFields.filter(field => field.visibility === 'hidden').map(field => field.id)
  }
} as const
