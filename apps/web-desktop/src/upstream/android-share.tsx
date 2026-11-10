import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '@nanostores/react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { listAllProfileSessions } from '@/api/sessions'
import { useNavigate } from 'react-router'
import { useComposerActions } from '@/app/chat/hooks/use-composer-actions'
import { requestComposerGetDraft } from '@/app/chat/composer/focus'
import { createComposerAttachmentScope, freshDraftScope, mainComposerScope } from '@/store/composer'
import { $activeGatewayProfile, ensureGatewayAgent, requestFreshSession } from '@/store/profile'
import { $activeSessionId, $gatewayState, $selectedStoredSessionId, $sessions } from '@/store/session'
import { $gatewaySwitching } from '@/store/gateway-switch'
import { androidFinishShare, androidHost, androidPendingShare, androidReadShare, isAndroidApp, type AndroidSharedFiles } from '../platform/android'
import { WEB_CONNECTION_ID } from '../platform/connection'
import { beginOperation, chatSelectionReadiness } from '../platform/reload-safety'
import { BrowserModal } from '../experience/ui/modal'
import { selectBrowserSession } from './selection'
import { prepareDefaultNewSession } from './default-session-profile'
import type { BrowserSessionSelection } from '../experience/contracts/selection'
import './android-share.css'

/** Staging owns a temporary attachment scope; late uploads cannot change a live conversation. */
export function AndroidSharePicker() {
  const [share, setShare] = useState<AndroidSharedFiles | null>(null)
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const sessions = useStore($sessions)
  const gateway = useStore($gatewayState)
  // Read-only picker pages span every profile without changing the sidebar's active scope.
  const chats = useInfiniteQuery({
    queryKey: ['android-share-chats', share?.id],
    enabled: Boolean(share) && gateway === 'open',
    initialPageParam: 0,
    queryFn: ({ pageParam }) => listAllProfileSessions(100, 0, 'exclude', 'recent', 'all', {}, pageParam),
    getNextPageParam: page => page.sessions.length && page.offset + page.limit < page.total ? page.offset + page.limit : undefined,
    gcTime: 0
  })
  const navigate = useNavigate()
  const returnFocus = useRef<HTMLElement | null>(null)
  const processing = useRef(false)
  const delivered = useRef(new Set<string>())
  const staged = useMemo(() => ({ ...createComposerAttachmentScope(), target: 'android-share-staging' }), [])
  const { attachDroppedItems } = useComposerActions({ activeSessionId: null, currentCwd: '', scope: staged,
    requestGateway: async () => { throw new Error('Shared file staging does not issue session commands.') } })

  useEffect(() => {
    if (!isAndroidApp()) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const host = await androidHost()
        if (!host?.capabilities.includes('share-files')) return
        if (!share && !processing.current && document.visibilityState === 'visible') {
          const pending = await androidPendingShare()
          if (pending && delivered.current.has(pending.id)) await androidFinishShare(pending.id)
          else if (pending && !stopped) {
            returnFocus.current = document.activeElement as HTMLElement | null
            setSearch(''); setError(''); setShare(pending)
          }
        }
      } catch { /* Native cache retains unread files while the page reconnects. */ }
      if (!stopped) timer = setTimeout(() => { void poll() }, 1200)
    }
    void poll()
    return () => { stopped = true; clearTimeout(timer) }
  }, [share])

  const dismiss = async () => {
    if (!share || processing.current) return
    try { await androidFinishShare(share.id); setShare(null) }
    catch (failure) { setError(String(failure)) }
  }
  const choose = async (selection: BrowserSessionSelection | null) => {
    if (!share || processing.current) return
    const readiness = chatSelectionReadiness()
    if (!readiness.ready) { setError(readiness.reason || 'Finish the current edit first.'); return }
    if ($gatewayState.get() !== 'open' || $gatewaySwitching.get()) { setError('Wait for Athena to connect, then try again.'); return }
    processing.current = true; setBusy(true); setError('')
    const finish = beginOperation()
    staged.clear()
    try {
      const files = await androidReadShare(share)
      const previousFreshScope = freshDraftScope()
      if (selection) {
        // All-profiles navigation may retain another API home; browser uploads need the chosen owner.
        await ensureGatewayAgent(selection.connectionId || WEB_CONNECTION_ID, selection.profile || 'default')
        selectBrowserSession(selection, navigate)
      } else { prepareDefaultNewSession(); requestFreshSession(); navigate('/') }
      const deadline = Date.now() + 15000
      let ready = false
      while (Date.now() < deadline) {
        const selected = $selectedStoredSessionId.get()
        const matches = selection
          ? selected === selection.sessionId && $activeGatewayProfile.get() === (selection.profile || 'default')
          : !selected && !$activeSessionId.get() && freshDraftScope() !== previousFreshScope
        if (matches && $gatewayState.get() === 'open' && !$gatewaySwitching.get()) {
          const scope = selection?.sessionId || freshDraftScope()
          const draft = await requestComposerGetDraft([scope])
          // Recheck after the acknowledged read: a newer selection owns its composer.
          if (draft && $selectedStoredSessionId.get() === selected &&
              (selection ? $activeGatewayProfile.get() === (selection.profile || 'default') : freshDraftScope() === scope)) {
            ready = true
            break
          }
        }
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      if (!ready) throw new Error('The chosen chat could not open. Your shared files are still available; try again.')
      const destinationScope = selection?.sessionId || freshDraftScope()
      const destinationProfile = $activeGatewayProfile.get()
      const stillSelected = () => $gatewayState.get() === 'open' && !$gatewaySwitching.get() &&
        $activeGatewayProfile.get() === destinationProfile &&
        (selection ? $selectedStoredSessionId.get() === selection.sessionId :
          !$selectedStoredSessionId.get() && !$activeSessionId.get() && freshDraftScope() === destinationScope)
      // Stage only after the destination profile is active: staged bytes retain that owner's route.
      for (const file of files) {
        if (!stillSelected()) throw new Error('The selected chat changed. Choose a chat again.')
        if (!await attachDroppedItems([{ file, path: '' }])) throw new Error(`Could not attach ${file.name}. Try again.`)
      }
      if (!stillSelected()) throw new Error('The selected chat changed. Choose a chat again.')
      // Synchronous transfer appends to the engine's current draft without replacing its text or chips.
      for (const attachment of staged.$attachments.get()) mainComposerScope.add(attachment)
      staged.clear({ retainPreviewUrls: true })
      delivered.current.add(share.id)
      setShare(null)
      // If acknowledgement fails, the poll retries it without reattaching the files.
      try { await androidFinishShare(share.id) } catch { /* Retry from the native inbox. */ }
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not attach shared files.') }
    finally { staged.clear(); processing.current = false; setBusy(false); finish() }
  }
  if (!share) return null
  const query = search.trim().toLowerCase()
  const key = (row: typeof sessions[number]) => JSON.stringify([row.connection_id, row.profile || 'default', row.id])
  const available = new Map((chats.data?.pages.flatMap(page => page.sessions) || []).map(row => [key(row), row]))
  for (const row of sessions) available.set(key(row), row)
  const rows = [...available.values()].filter(row => !row.archived && `${row.title || row.id} ${row.profile || 'default'}`.toLowerCase().includes(query))
  return <BrowserModal title="Attach shared files" open onOpenChange={open => { if (!open && !busy) void dismiss() }} returnFocus={returnFocus} className="android-share-picker">
    <p className="android-share-files">{share.files.map(file => file.name).join(', ')}</p>
    <p className="android-share-hint">Choose a chat. Files will be added to its draft for you to review and send.</p>
    <input className="android-share-search" aria-label="Search chats" placeholder="Search chats" value={search} disabled={busy} onChange={event => setSearch(event.target.value)} />
    {error && <p className="android-share-error" role="alert">{error}</p>}
    {gateway !== 'open' && <p role="status">Connecting to Athena…</p>}
    <div className="android-share-chats" aria-label="Choose a chat" aria-busy={busy}>
      <button type="button" disabled={busy || gateway !== 'open'} onClick={() => void choose(null)}>＋ New chat</button>
      {rows.map(row => <button type="button" key={`${row.connection_id}:${row.profile}:${row.id}`} disabled={busy || gateway !== 'open'} onClick={() => void choose({ sessionId: row.id, profile: row.profile || 'default', connectionId: row.connection_id || undefined })}>
        <span>{row.title || 'Untitled chat'}</span><small>{row.profile || 'default'}</small>
      </button>)}
      {chats.isPending && <p role="status">Loading chats…</p>}
      {chats.isError && <button type="button" disabled={busy} onClick={() => void chats.refetch()}>Could not load all chats. Retry</button>}
      {chats.hasNextPage && <button type="button" disabled={busy || chats.isFetchingNextPage} onClick={() => void chats.fetchNextPage()}>Load more chats</button>}
      {!rows.length && !chats.isPending && <p>No matching chats. You can start a new chat.</p>}
    </div>
    <div className="android-share-footer">{busy && <span role="status">Attaching files…</span>}<button type="button" disabled={busy} onClick={() => void dismiss()}>Cancel</button></div>
  </BrowserModal>
}
