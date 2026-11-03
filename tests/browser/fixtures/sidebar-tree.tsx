import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRepository, BrowserTreeAdd, BrowserTreeBody, BrowserTreeHeader, BrowserTreeMore, BrowserTreeStack } from '../../../apps/web-desktop/src/experience/sidebar-tree'

const fixture = window as typeof window & { treeEvents: string[] }
fixture.treeEvents = []
const label = 'feature/keep-distinct-tail'

function Lane({ owner }: { owner: string }) {
  const [open, setOpen] = useState(true), [count, setCount] = useState(5)
  const sessions = Array.from({ length: 7 }, (_, index) => `Worktree conversation ${index}`)
  return <BrowserTreeStack>
    <BrowserTreeHeader model={{ label, title: '/workspace/linked', icon: <span aria-hidden="true">◇</span>, open,
      toggle: () => setOpen(value => !value), actions: <BrowserTreeAdd label={`New conversation in ${owner}`} onClick={() => fixture.treeEvents.push(`${owner}:create`)} /> }} />
    {open && <BrowserTreeBody empty={false} emptyLabel="No sessions" more={count < sessions.length && <BrowserTreeMore label="Show 2 more conversations" onClick={() => setCount(7)} />}>
      {sessions.slice(0, count).map(title => <button type="button" key={title}>{title}</button>)}
    </BrowserTreeBody>}
  </BrowserTreeStack>
}

function Fixture() {
  const [open, setOpen] = useState(true), [owner, setOwner] = useState('Research'), [draft, setDraft] = useState('Preserve this tree draft')
  return <><label>Draft<textarea value={draft} onChange={event => setDraft(event.target.value)} /></label>
    <button type="button" onClick={() => setOwner('Writer')}>Change owner</button>
    <BrowserRepository model={{ label: 'Repository A', emphasis: true, icon: <span aria-hidden="true">◇</span>, open, toggle: () => setOpen(value => !value) }} dialogs={null}>
      <Lane owner={owner} />
    </BrowserRepository>
  </>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
