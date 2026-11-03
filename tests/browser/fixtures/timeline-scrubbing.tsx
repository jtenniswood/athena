import React, { useMemo, useState } from 'react'
import 'tailwindcss/preflight.css'
import { createRoot } from 'react-dom/client'
import { TimelineRail } from '../../../apps/desktop/src/components/assistant-ui/thread/timeline-rail'

const fixture = window as typeof window & { timelineJumps: string[]; timelineSyntheticClicks: number }
fixture.timelineJumps = []
fixture.timelineSyntheticClicks = 0

function Rail({ owner }: { owner: string }) {
  const entries = useMemo(() => Array.from({ length: 5000 }, (_, index) => ({ id: `${owner}-${index}`, preview: `${owner} message ${index}` })), [owner])
  const [active, setActive] = useState(0)
  return <div data-testid={owner} style={{ height: 280, width: 48 }} onClickCapture={event => {
    if (!event.isTrusted) fixture.timelineSyntheticClicks++
  }}><TimelineRail activeIndex={active} entries={entries} loadingId={null} onJump={id => {
    fixture.timelineJumps.push(id)
    setActive(entries.findIndex(entry => entry.id === id))
  }} /></div>
}

function Fixture() {
  const [owner, setOwner] = useState('research'), [shown, setShown] = useState(true), [scale, setScale] = useState(1)
  return <>
    <button onClick={() => setOwner('writer')}>Change conversation</button>
    <button onClick={() => setShown(value => !value)}>Toggle rail</button>
    <button onClick={() => setScale(1.25)}>Scale UI</button>
    <label>Draft<input defaultValue="Preserve this draft" /></label>
    <div style={{ display: 'flex', gap: 100, zoom: scale, marginTop: 30 }}>
      {shown && <Rail owner={owner} />}<Rail owner="other" />
    </div>
  </>
}

createRoot(document.getElementById('root')!).render(<Fixture />)
