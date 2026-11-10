import type { ReactNode, RefObject } from 'react'
import { SearchField } from '../upstream/browser-api'
import { BrowserSidebarSettings } from './sidebar-extras'
import { OpenCodeGoUsage } from './opencode-go-usage'
import { browserClassNames as cn } from './ui/classnames'

export interface BrowserSidebarModel {
  navigation: { id: string; label: string; icon: ReactNode; active: boolean; disabled: boolean; run(): void }[]
  flipped: boolean
  showSections: boolean
  search: { value: string; input: RefObject<HTMLInputElement | null>; change(value: string): void }
  mode: string
  project?: string
  notice: ReactNode
  empty: ReactNode
  profileRail: ReactNode
  dialogs: ReactNode
}

/** Athena's navigation layout consumes projections, never mutable engine stores. */
export function BrowserSidebar({ model, children }: { model: BrowserSidebarModel; children: ReactNode }) {
  return <div data-slot="sidebar" data-tour="sessions-sidebar" data-tip-region="" className={cn(
    'relative flex h-full w-(--sidebar-width) min-w-0 flex-col overflow-hidden border-t-0 border-b-0 border-(--sidebar-edge-border) bg-(--ui-sidebar-surface-background) text-foreground opacity-100 transition-none',
    model.flipped ? 'border-l border-r-0' : 'border-r border-l-0')}>
    <div data-slot="sidebar-content" data-sidebar="content" className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden bg-transparent px-2.5">
      <div data-sidebar="group" data-slot="sidebar-group" className="relative flex w-full min-w-0 shrink-0 flex-col p-0 pb-2 pt-[calc(var(--titlebar-height)+0.375rem)]">
        <div data-sidebar="group-content" className="w-full text-sm"><ul data-sidebar="menu" className="flex w-full min-w-0 flex-col gap-px">
          {model.navigation.map(item => <li key={item.id} data-sidebar="menu-item" className="group/menu-item relative">
            <button type="button" data-sidebar="menu-button" data-slot="sidebar-menu-button" data-tip-region="" aria-disabled={item.disabled}
              onClick={item.disabled ? undefined : item.run} title={item.label}
              className={cn('flex h-7 w-full items-center justify-start gap-2 rounded-md border border-transparent px-2 text-left text-[0.8125rem] font-medium text-(--ui-text-secondary) transition-colors duration-100 ease-out [-webkit-app-region:no-drag] hover:bg-(--ui-control-hover-background) hover:text-foreground hover:transition-none',
                item.active && 'border-(--ui-stroke-tertiary) bg-(--ui-control-active-background) text-foreground shadow-none hover:border-(--ui-stroke-tertiary)!',
                item.disabled && 'cursor-default hover:border-transparent hover:bg-transparent hover:text-inherit')}>
              {item.icon}<span className="min-w-0 truncate" data-tip-arrow-only="" data-tour={`sidebar-nav-${item.id}`}>{item.label}</span>
            </button>
          </li>)}
        </ul></div>
      </div>
      {model.notice}
      {model.showSections ? <div data-sessions-mode={model.mode} data-sessions-project={model.project}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden overscroll-contain pb-1.75 [scrollbar-gutter:stable] scrollbar-fade">{children}</div> : model.empty}
      <div data-slot="sidebar-footer" className="mt-auto min-h-0 shrink overflow-y-auto overflow-x-hidden overscroll-contain pb-1 pt-1 scrollbar-fade">
        <OpenCodeGoUsage />
        <BrowserSidebarSettings />
        {model.showSections && <div className="browser-session-search-section px-2 pt-1">
          <SearchField containerClassName="browser-session-search" aria-label="Search" placeholder="Search" inputRef={model.search.input} value={model.search.value} onChange={model.search.change} />
        </div>}
      </div>
      {model.profileRail}
    </div>
    {model.dialogs}
  </div>
}
