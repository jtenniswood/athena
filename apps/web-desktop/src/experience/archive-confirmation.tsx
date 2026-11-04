import { useStore } from '@nanostores/react'
import { atom } from 'nanostores'
import { ConfirmDialog } from '../upstream/ui'

type ArchiveConfirmation = { stop: () => Promise<void>; resolve: (confirmed: boolean) => void }
const $confirmation = atom<ArchiveConfirmation | null>(null)

export function confirmRunningChatArchive(stop: () => Promise<void>): Promise<boolean> {
  if ($confirmation.get()) return Promise.resolve(false)
  return new Promise(resolve => $confirmation.set({ stop, resolve }))
}

export function BrowserArchiveConfirmation() {
  const confirmation = useStore($confirmation)
  return <ConfirmDialog open={Boolean(confirmation)} title="Stop and archive this chat?"
    description="Archiving will stop the current response. You can restore the chat later in Settings."
    destructive confirmLabel="Stop and archive" busyLabel="Stopping…" doneLabel="Stopped"
    onClose={() => { confirmation?.resolve(false); $confirmation.set(null) }}
    onConfirm={async () => { await confirmation?.stop(); confirmation?.resolve(true) }} />
}
