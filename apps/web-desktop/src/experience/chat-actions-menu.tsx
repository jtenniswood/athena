import { useRef, useState, type RefObject } from 'react'
import { Codicon, Dialog, DialogContent, DialogTitle, useI18n } from '../upstream/browser-api'
import { Button, ConfirmDialog, Input } from '../upstream/ui'
import type { BrowserSessionActions } from './contracts/actions'
import type { BrowserHostPanel } from './contracts/host'
import { BrowserActionSurface, type BrowserActionAnchor, type BrowserActionGroup } from './ui/action-surface'
import { BrowserToolbarButton } from './ui/toolbar-button'
import { useMobileBrowser } from './ui/use-compact-browser'
import { useBrowserDialogReturnFocus } from './ui/dialog-focus'
import { browserSessionActionLabel, useBrowserSessionShortcuts } from './session-shortcuts'

/** Menus and keyboard shortcuts share browser commands and capture dialog owners. */
export function BrowserChatActionsMenu({ actions, title, panels, main }: {
  actions: BrowserSessionActions
  title: string
  panels: readonly BrowserHostPanel[]
  main: RefObject<HTMLElement | null>
}) {
  const { t } = useI18n()
  const r = t.sidebar.row
  const compact = useMobileBrowser()
  const trigger = useRef<HTMLButtonElement>(null)
  const [anchor, setAnchor] = useState<BrowserActionAnchor | null>(null)
  const [dialog, setDialog] = useState<{ kind: 'rename' | 'delete'; actions: BrowserSessionActions; title: string } | null>(null)
  const openDialog = (kind: 'rename' | 'delete') => setDialog({ kind, actions, title })
  const renameLabel = r.rename.replace(/(?:\.{3}|…)$/, '')
  const pinLabel = actions.pinned ? r.unpin : r.pin
  const unreadLabel = actions.unread ? r.markRead : r.markUnread
  const panelActions = panels.map(panel => ({
    key: panel.id, label: panel.label, checked: panel.checked,
    labelContent: panel.id === 'files' || panel.id === 'review' ? browserSessionActionLabel(panel.id, panel.label) : undefined,
    icon: <Codicon name={panel.id === 'review' ? 'git-compare' : 'files'} />,
    run: () => { if (panel.select()) main.current?.focus() }
  }))
  const groups: BrowserActionGroup[] = [
    { key: 'conversation', actions: [
      { key: 'rename', label: renameLabel, labelContent: browserSessionActionLabel('rename', renameLabel), icon: <Codicon name="edit" />, afterClose: true, run: () => openDialog('rename') },
      { key: 'pin', label: pinLabel, labelContent: browserSessionActionLabel('pin', pinLabel), icon: <Codicon name="pin" />, run: actions.togglePin },
      { key: 'unread', label: unreadLabel, labelContent: browserSessionActionLabel('unread', unreadLabel), icon: <Codicon name={actions.unread ? 'mail-read' : 'mail'} />, run: () => void actions.toggleUnread() },
      ...panelActions
    ] },
    { key: 'danger', actions: [
      { key: 'archive', label: r.archive, labelContent: browserSessionActionLabel('archive', r.archive), icon: <Codicon name="archive" />, run: () => void actions.archive() },
      { key: 'delete', label: t.common.delete, labelContent: browserSessionActionLabel('delete', t.common.delete), icon: <Codicon name="trash" />, destructive: true, afterClose: true, run: () => openDialog('delete') }
    ] }
  ]
  const panelShortcut = (id: string) => ({
    disabled: !panels.some(panel => panel.id === id),
    onSelect: () => { if (panels.find(panel => panel.id === id)?.select('toggle')) main.current?.focus() }
  })
  useBrowserSessionShortcuts(Boolean(actions.sessionId), {
    rename: { onSelect: () => openDialog('rename') },
    pin: { onSelect: actions.togglePin },
    unread: { onSelect: () => void actions.toggleUnread() },
    archive: { onSelect: () => void actions.archive() },
    delete: { onSelect: () => openDialog('delete') },
    files: panelShortcut('files'), review: panelShortcut('review')
  })
  return <>
    {actions.sessionId && <BrowserToolbarButton tooltip="Chat actions" ref={trigger} className="browser-chat-actions" aria-label="Chat actions" aria-haspopup={compact ? 'dialog' : 'menu'} aria-expanded={Boolean(anchor)} onClick={event => {
      const bounds = event.currentTarget.getBoundingClientRect()
      setAnchor({ x: bounds.right, y: bounds.bottom, returnFocus: event.currentTarget })
    }}><Codicon name="ellipsis" /></BrowserToolbarButton>}
    <BrowserActionSurface title="Chat actions" groups={groups} anchor={anchor} compact={compact} onClose={() => setAnchor(null)} fallbackFocus={trigger} />
    {dialog?.kind === 'rename' && <BrowserRenameSessionDialog actions={dialog.actions} title={dialog.title} onClose={() => setDialog(null)} />}
    <ConfirmDialog open={dialog?.kind === 'delete'} title={r.deleteTitle} description={r.deleteDesc(dialog?.title || '')} destructive confirmLabel={t.common.delete} busyLabel={r.deleting} doneLabel={r.deleted} onClose={() => setDialog(null)} onConfirm={() => dialog?.actions.delete()} />
  </>
}

function BrowserRenameSessionDialog({ actions, title, onClose }: { actions: BrowserSessionActions; title: string; onClose(): void }) {
  const { t } = useI18n()
  const [value, setValue] = useState(title)
  const [saving, setSaving] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const returnFocus = useBrowserDialogReturnFocus(true)
  const submit = async () => {
    if (saving) return
    if (value.trim() === title.trim()) { onClose(); return }
    setSaving(true)
    try { if (await actions.rename(value)) onClose() }
    finally { setSaving(false) }
  }
  return <Dialog open onOpenChange={open => { if (!open && !saving) onClose() }}>
    <DialogContent className="max-w-md" aria-describedby={undefined} onOpenAutoFocus={event => { event.preventDefault(); input.current?.focus(); input.current?.select() }} onCloseAutoFocus={returnFocus}>
      <DialogTitle>{t.sidebar.row.renameTitle}</DialogTitle>
      <form onSubmit={event => { event.preventDefault(); void submit() }}>
        <Input ref={input} aria-label={t.sidebar.row.renameTitle} value={value} disabled={saving} placeholder={t.sidebar.row.untitledPlaceholder} onChange={event => setValue(event.target.value)} />
        <div className="flex justify-end gap-2 pt-4">
          <Button type="button" variant="ghost" disabled={saving} onClick={onClose}>{t.common.cancel}</Button>
          <Button type="submit" disabled={saving}>{t.common.save}</Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>
}
