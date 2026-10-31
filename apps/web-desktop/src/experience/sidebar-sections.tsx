import { createContext, useCallback, useContext, useEffect, useId, useState, type ReactNode } from 'react'
import { BrowserActionSurface, type BrowserActionAnchor, type BrowserAction } from './ui/action-surface'
import { useMobileBrowser } from './ui/use-compact-browser'
import { Codicon, MESSAGING_SESSION_SOURCE_IDS, sessionSourceLabel } from '../upstream/browser-api'
import { notifyConversationOpen } from './conversation-navigation'

import { browserPreference, useBrowserPreference } from '../platform/preferences'
import { browserPreferences, migrateBrowserPreference } from '../../../../scripts/browser-preference-contract.mjs'
import { saveSyncedPreference } from '../platform/preference-sync'

type SidebarSection = { key: string; label: string }

type SectionRegistry = ReturnType<typeof useBrowserSidebarSections>
const SidebarSectionsContext = createContext<SectionRegistry | null>(null)

// Called by the checked renderer adapter. Identity comes from the section's
// data model; translated labels are display-only and rows may be collapsed.
export function useBrowserSidebarSection(key: string, label: string) {
  const registry = useContext(SidebarSectionsContext)
  const instance = useId()
  const register = registry?.register
  useEffect(() => register?.(instance, { key, label }), [register, instance, key, label])
  return {
    'data-browser-section-id': key,
    'data-browser-section-hidden': key !== 'sessions' && registry?.hiddenSections.includes(key) ? '' : undefined
  }
}

export function useBrowserSidebarSections() {
  const hiddenSections = useBrowserPreference('hiddenSections')
  useEffect(() => {
    try { migrateBrowserPreference(browserPreferences.hiddenSections, window.localStorage, saveSyncedPreference) }
    catch { /* Sidebar visibility remains available without storage. */ }
  }, [])
  const [registered, setRegistered] = useState<Map<string, SidebarSection>>(() => new Map())
  const register = useCallback((instance: string, section: SidebarSection) => {
    setRegistered(current => new Map(current).set(instance, section))
    return () => setRegistered(current => {
      const next = new Map(current)
      next.delete(instance)
      return next
    })
  }, [])
  const availableSections = [...new Map([...registered.values()].map(section => [section.key, section])).values()]
  if (!availableSections.some(section => section.key === 'cron-jobs')) availableSections.push({ key: 'cron-jobs', label: 'Cron jobs' })
  // Keep channel controls available before chats load and while their groups
  // are absent (for example during search or when all chats are pinned).
  for (const sourceId of MESSAGING_SESSION_SOURCE_IDS) {
    const key = `messaging:${sourceId}`
    if (!availableSections.some(section => section.key === key)) {
      availableSections.push({ key, label: sessionSourceLabel(sourceId) ?? sourceId })
    }
  }
  const actions: BrowserAction[] = availableSections.filter(section => section.key !== 'sessions').map(section => ({
    key: section.key,
    label: section.label,
    icon: <Codicon name={section.key === 'cron-jobs' ? 'watch' : section.key.startsWith('messaging:') ? 'comment' : section.key === 'pinned' ? 'pin' : 'folder'} size="1rem" />,
    checked: !hiddenSections.includes(section.key),
    keepOpen: true,
    run: () => browserPreference('hiddenSections').write(hiddenSections.includes(section.key) ? hiddenSections.filter(key => key !== section.key) : [...hiddenSections, section.key])
  }))
  return { hiddenSections, register, actions }
}

export function BrowserSessionsPane({ hidden, sections, children }: { hidden: boolean; sections: ReturnType<typeof useBrowserSidebarSections>; children: ReactNode }) {
  const compact = useMobileBrowser()
  const [anchor, setAnchor] = useState<BrowserActionAnchor | null>(null)
  const fallback = { current: document.querySelector<HTMLButtonElement>('.browser-navigation-actions-trigger') }
  useEffect(() => { if (hidden) setAnchor(null) }, [hidden])
  // Let the upstream context-menu coordinator leave this browser surface alone.
  return <SidebarSectionsContext.Provider value={sections}><div data-hermes-context-menu-trigger="" hidden={hidden} className="browser-pane browser-sessions-pane" onContextMenu={event => {
    // Session-row menus own their actions and must not open the section surface.
    if (event.defaultPrevented || (event.target instanceof Element && event.target.closest('[data-row-actions]'))) return
    event.preventDefault()
    event.stopPropagation()
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('button,a,input,[tabindex]') : null
    setAnchor({ x: event.clientX, y: event.clientY, returnFocus: target || event.currentTarget })
  }} onClickCapture={event => {
    if (!compact || !(event.target instanceof Element)) return
    const button = event.target.closest('button')
    if (!button) return
    const label = [button.getAttribute('aria-label'), button.getAttribute('title'), button.textContent]
      .filter(Boolean)
      .join(' ')
      .trim()
    if (/^New session(?:\s|$)/i.test(label)) notifyConversationOpen()
  }}>
    {children}
    <BrowserActionSurface title="Sidebar sections" actions={sections.actions} anchor={anchor} compact={compact} fallbackFocus={fallback} onClose={() => setAnchor(null)} />
  </div></SidebarSectionsContext.Provider>
}
