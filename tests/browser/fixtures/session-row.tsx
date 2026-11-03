import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createPortal } from 'react-dom'
import { BrowserSessionRow } from '../../../apps/web-desktop/src/experience/session-row'
import type { BrowserSessionRowModel } from '../../../apps/web-desktop/src/experience/contracts/session-row'

const fixture = window as typeof window & { rowEvents: string[] }
fixture.rowEvents = []
function Row({ profile, card }: { profile: string; card: boolean }) {
  const [portal, setPortal] = useState(false)
  const record = (action: string) => { fixture.rowEvents.push(`${profile}:${action}`) }
  const row: BrowserSessionRowModel = {
    id: 'shared-id', profile, title: `${profile} conversation`, selected: false, working: false, running: false,
    openElsewhere: false, dragging: false, reorderable: true, branch: false, card, density: 'detailed',
    context: `${profile} project`, metadata: 'Model · 3 messages', preview: 'Initial request', cardPreview: 'Last reply',
    model: 'Model', size: '3 messages', progress: '1/3', progressLabel: 'Plan progress',
    status: <span aria-label="Idle">●</span>, origin: null, leading: null, trailing: null, figures: <time>2h</time>,
    dragHandleProps: { role: 'button', tabIndex: 0, onKeyDown: event => { if (event.key === ' ') { event.preventDefault(); record('reorder') } } },
    actions: <><button type="button" aria-label={`${profile} actions`} onClick={() => { record('actions'); setPortal(true) }}>Actions</button>
      {portal && createPortal(<div role="dialog" aria-label={`${profile} dialog`}><button type="button" onClick={() => { record('portal'); setPortal(false) }}>Confirm {profile}</button></div>, document.body)}</>,
    activate: () => record('resume'), togglePin: () => record('pin'), archive: () => record('archive')
  }
  return <BrowserSessionRow row={row} />
}
function Fixture() {
  const [card, setCard] = useState(false), [draft, setDraft] = useState('Preserve this draft')
  return <><label>Draft<textarea value={draft} onChange={event => setDraft(event.target.value)} /></label>
    <button type="button" onClick={() => setCard(value => !value)}>Change density</button>
    <Row profile="Research" card={card} /><Row profile="Writer" card={card} /></>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
