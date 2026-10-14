import { Codicon, type OverlayNavGroup } from '../../upstream/browser-api'
import { useBrowserSettingsController } from '../../upstream/settings-controller-api'
import type { BrowserSettingsPageProps } from '../contracts/settings'
import { settingsCatalog, settingsPageIsVisible, settingsPageLabel } from './catalog'
import { BrowserSettingsPresentation } from './frame'

/** Athena assembles the settings route; the adapter supplies the existing engine pages. */
export function SettingsView(props: BrowserSettingsPageProps) {
  const controller = useBrowserSettingsController(props)
  const known = new Set(settingsCatalog.flatMap(group => group.pages.map(page => page.id)))
  const native = new Map(controller.nativePages.map(page => [page.id, page]))
  const pages: OverlayNavGroup[] = settingsCatalog.flatMap(group => group.pages).filter(page => settingsPageIsVisible(page.id)).map(page => {
    const contributed = native.get(page.id)
    return {
      ...contributed,
      id: page.id, label: page.title, active: controller.view === page.id,
      icon: contributed?.icon ?? (({ className }: { className?: string }) => <Codicon name={page.icon ?? 'settings-gear'} className={className} />),
      onSelect: () => controller.openPage(page.id),
      children: contributed?.children?.map(child => ({ ...child, label: settingsPageLabel(child.id, child.label) }))
    }
  })
  // Unknown renderer pages retain their controls and an Other Settings destination.
  pages.push(...controller.nativePages.filter(page => !known.has(page.id) && settingsPageIsVisible(page.id)))
  return <BrowserSettingsPresentation
    activeView={controller.view} backLabel={controller.labels.back} closeLabel={controller.labels.close}
    groups={pages} onClose={props.onClose} title={controller.labels.title}
    search={<button
      type="button" aria-label={controller.search.label} tabIndex={controller.search.active ? -1 : undefined}
      className={`browser-settings-search-button${controller.search.active ? ' is-active' : ''}`}
      onClick={controller.search.open}
    ><Codicon name="search" /><span>{controller.search.label}</span>{controller.search.hint && <kbd>{controller.search.hint}</kbd>}</button>}
  >{controller.content}</BrowserSettingsPresentation>
}
export { SettingsView as SettingsPage }
