import type { ReactNode } from 'react'
import './archived-sessions-table.css'

export function BrowserArchivedSessionsTable({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="browser-archived-table-scroll" role="region" aria-label={title} tabIndex={0}>
      <table className="browser-archived-table" aria-label={title}>
        <colgroup>
          <col className="browser-archived-session-column" />
          <col className="browser-archived-preview-column" />
          <col className="browser-archived-messages-column" />
          <col className="browser-archived-actions-column" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Session</th>
            <th scope="col">Preview</th>
            <th scope="col" className="browser-archived-messages">Messages</th>
            <th scope="col" className="browser-archived-actions">Actions</th>
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

export function BrowserArchivedSessionRow({ id, title, description, workspace, messageCount, messageLabel, action }: {
  id: string
  title: string
  description?: string
  workspace: string
  messageCount: number
  messageLabel: string
  action: ReactNode
}) {
  return (
    <tr id={id} className="scroll-mt-6">
      <th scope="row">
        <div className="browser-archived-title" title={title}>{title}</div>
        {workspace && <div className="browser-archived-workspace" title={workspace}>{workspace}</div>}
      </th>
      <td><div className="browser-archived-preview" title={description}>{description || '—'}</div></td>
      <td className="browser-archived-messages" aria-label={messageLabel}>{messageCount}</td>
      <td className="browser-archived-actions">{action}</td>
    </tr>
  )
}
