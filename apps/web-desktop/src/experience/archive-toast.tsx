import { useStore } from '@nanostores/react'
import { atom } from 'nanostores'
import { useEffect, useRef, useState, type Ref } from 'react'
import { Codicon } from '../upstream/browser-api'
import './archive-toast.css'

export const ARCHIVE_FOOTER_ID = 'browser-archive-footer'

type ArchiveNotice = { id: number; undo: () => Promise<void> }
const $archives = atom<ArchiveNotice[]>([])
let nextId = 0
const dismiss = (id: number) => $archives.set($archives.get().filter(notice => notice.id !== id))

export function showArchivedChatToast(undo: () => Promise<void>): void {
  $archives.set([{ id: ++nextId, undo }, ...$archives.get()])
}

function ArchiveToast({ notice }: { notice: ArchiveNotice }) {
  const [hovered, setHovered] = useState(false), [focused, setFocused] = useState(false)
  const [pending, setPending] = useState(false), [failed, setFailed] = useState(false)
  const running = useRef(false)
  useEffect(() => {
    if (hovered || focused || pending || failed) return
    const timer = window.setTimeout(() => dismiss(notice.id), 10_000)
    return () => window.clearTimeout(timer)
  }, [notice.id, hovered, focused, pending, failed])
  const undo = async () => {
    if (running.current) return
    running.current = true
    setPending(true)
    setFailed(false)
    try { await notice.undo(); dismiss(notice.id) }
    catch { setFailed(true) }
    finally { running.current = false; setPending(false) }
  }
  return <div className="browser-archive-toast" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onFocusCapture={() => setFocused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false) }}>
    <Codicon name="archive" />
    <span role={failed ? 'alert' : 'status'}>{failed ? 'Could not unarchive chat. Try again.' : 'Archived chat'}</span>
    <button type="button" className="browser-archive-undo" disabled={pending} onClick={() => void undo()}>{pending ? 'Restoring…' : 'Undo'}</button>
    <button type="button" className="browser-archive-dismiss" aria-label="Dismiss archive notification" onClick={() => dismiss(notice.id)}><Codicon name="close" /></button>
  </div>
}

export function BrowserArchiveToasts({ ref }: { ref: Ref<HTMLDivElement> }) {
  const notices = useStore($archives)
  return <div id={ARCHIVE_FOOTER_ID} ref={ref} className="browser-archive-toasts" role="region" aria-label="Archived chats">
    {notices.map(notice => <ArchiveToast key={notice.id} notice={notice} />)}
  </div>
}
