import type { ComponentProps, ReactNode } from 'react'
import { SearchField, useI18n, type PageSearchShell } from '../upstream/browser-api'
import './messaging.css'

/** Presentation only: the upstream page still owns profiles, edits and actions. */
export function BrowserMessagingShell({ children, className = '', onSearchChange, searchPlaceholder,
  searchValue, searchHidden, searchTrailingAction, searchHints: _hints, ...props
}: ComponentProps<typeof PageSearchShell>) {
  const { t } = useI18n()
  const copy = t.commandCenter.nav.messaging
  return <section {...props} className={`browser-messaging ${className}`}>
    <header className="browser-messaging-header">
      <div>
        <h1>{copy.title}</h1>
        <p>{copy.detail}</p>
      </div>
      {!searchHidden && onSearchChange && <div className="browser-messaging-search">
        <SearchField variant="box" onChange={onSearchChange} aria-label={searchPlaceholder ?? t.messaging.search} placeholder={t.titlebar.search} value={searchValue ?? ''} />
      </div>}
      {searchTrailingAction && <div className="browser-messaging-filters">{searchTrailingAction}</div>}
    </header>
    <div className="browser-messaging-body">{children}</div>
  </section>
}

export function BrowserMessagingLayout({ children }: { children: ReactNode }) {
  return <div className="browser-messaging-layout">{children}</div>
}

export function BrowserMessagingList({ children, empty }: { children: ReactNode; empty: boolean }) {
  return <aside className="browser-messaging-list" aria-label="Messaging platforms">
    <div className="browser-messaging-list-heading">Platforms</div>
    <div className="browser-messaging-list-scroll">
      {children}
      {empty && <p className="browser-messaging-empty" role="status">No matching platforms.</p>}
    </div>
  </aside>
}

export function BrowserMessagingDetail({ children, actionBar }: { children: ReactNode; actionBar?: ReactNode }) {
  return <main className="browser-messaging-detail">
    <div className="browser-messaging-detail-scroll">
      <div className="browser-messaging-content">{children}</div>
    </div>
    {actionBar && <footer className="browser-messaging-actions"><div>{actionBar}</div></footer>}
  </main>
}
