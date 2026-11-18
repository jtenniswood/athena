import type { ReactNode } from 'react'
import { BrowserCronRow, BrowserCronRuns } from '../experience/sidebar-cron'
import { BrowserSidebarSection } from '../experience/sidebar-section'

function CronSidebarSection({ label, open, toggle, children }: {
  label: string; open: boolean; toggle(): void; children: ReactNode
}) {
  return <BrowserSidebarSection model={{
    id: 'cron-jobs', label, open, toggle, collapsible: true, pinned: false, acceptsSessionDrops: false,
    className: 'shrink-0 p-0 pb-1',
    contentClassName: 'scrollbar-fade flex max-h-72 flex-col gap-px overflow-x-hidden overflow-y-auto overscroll-contain pb-1.75 compact:max-h-none compact:overflow-visible'
  }}>{children}</BrowserSidebarSection>
}

export const browserCronSidebarPresentation = { Section: CronSidebarSection, Row: BrowserCronRow, Runs: BrowserCronRuns }
