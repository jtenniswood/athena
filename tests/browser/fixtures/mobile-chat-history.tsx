import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, useLocation, useNavigate } from 'react-router'
import { useMobileChatHistory } from '../../../apps/web-desktop/src/experience/mobile-chat-history'

function Fixture() {
  const [drawerOpen, setDrawerOpen] = useState(true)
  const [tab, setTab] = useState('bots')
  const [mobile, setMobile] = useState(true)
  const location = useLocation(), navigate = useNavigate()
  const back = useMobileChatHistory({
    mobile, drawerOpen, covered: location.pathname === '/settings',
    showHistory: () => { setTab('sessions'); setDrawerOpen(true) },
    showConversation: () => setDrawerOpen(false)
  })
  return <>
    <button onClick={() => setMobile(value => !value)}>Toggle mobile</button>
    <section hidden={!drawerOpen} aria-label="History">
      <output>{tab}</output>
      <button onClick={() => { void navigate('/chat-a', { state: { preserved: 'owner' } }); setDrawerOpen(false) }}>Open chat A</button>
      <button onClick={() => { void navigate('/chat-b'); setDrawerOpen(false) }}>Open chat B</button>
      <button onClick={() => setDrawerOpen(false)}>Reopen selected chat</button>
    </section>
    <section hidden={drawerOpen} aria-label="Conversation">
      <button onClick={back}>Back to chat history</button>
      <textarea aria-label="Draft" />
      <button onClick={() => { void navigate('/settings') }}>Settings</button>
    </section>
    <output aria-label="Route">{location.pathname}</output>
  </>
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><BrowserRouter><Fixture /></BrowserRouter></React.StrictMode>)
