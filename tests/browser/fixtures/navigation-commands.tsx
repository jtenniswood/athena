import React, { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, useLocation } from 'react-router'
import { BrowserEngineProvider } from '../../../apps/web-desktop/src/experience/engine'
import type { BrowserEngine } from '../../../apps/web-desktop/src/experience/contracts/engine'
import { useBrowserNavigation } from '../../../apps/web-desktop/src/experience/navigation'
import { BrowserSidebarProject } from '../../../apps/web-desktop/src/experience/sidebar-project'
import { BrowserTreeAdd } from '../../../apps/web-desktop/src/experience/sidebar-tree'

// This fixture exercises navigation and real sidebar commands. Engine state is
// represented only by a changing selection; no conversation data is copied.
const engine = { protocol: 1, navigation: { coversWorkspace: () => false } } as BrowserEngine
function Fixture() {
  const [selection, setSelection] = useState(0)
  const main = useRef<HTMLElement>(null), trigger = useRef<HTMLButtonElement>(null), anchor = useRef<HTMLDivElement>(null)
  const location = useLocation()
  const navigation = useBrowserNavigation({ selectionKey: String(selection), path: location.pathname, main, trigger })
  const create = () => setSelection(value => value + 1)
  return <>
    <button ref={trigger} onClick={navigation.toggle}>Toggle navigation</button>
    <section ref={navigation.drawer} aria-label="Navigation" hidden={!navigation.open}>
      <BrowserTreeAdd label="Create workspace chat" onClick={create} />
      <BrowserSidebarProject model={{ id: 'project', label: 'Research', icon: 'folder', active: false, open: true,
        hasRows: false, dragging: false, reorderable: false, reorderLabel: 'Reorder Research', toggleLabel: 'Toggle Research',
        anchor, toggle() {}, enter() {}, menu: null, figures: '', more: [], create: { label: 'Create project chat', run: create } }} />
      <button className="group-hover/workspace:opacity-100" onClick={create}>Unrelated selection</button>
    </section>
    <main ref={main} tabIndex={-1}><output aria-label="Selection">{selection}</output><textarea aria-label="Draft" defaultValue="Preserve this draft" /></main>
  </>
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><BrowserRouter><BrowserEngineProvider engine={engine}><Fixture /></BrowserEngineProvider></BrowserRouter></React.StrictMode>)
