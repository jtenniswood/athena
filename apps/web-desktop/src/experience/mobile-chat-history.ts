import { useEffect, useRef } from 'react'
import { useLocation, useNavigate, useNavigationType } from 'react-router'

const CHAT_ENTRY = 'athenaMobileChat'

/** Give the mobile conversation a Back destination without unmounting its draft. */
export function useMobileChatHistory({ mobile, drawerOpen, covered, showHistory, showConversation }: {
  mobile: boolean
  drawerOpen: boolean
  covered: boolean
  showHistory: () => void
  showConversation: () => void
}) {
  const location = useLocation()
  const navigate = useNavigate()
  const navigationType = useNavigationType()
  const previous = useRef({ key: location.key, drawerOpen })
  const opening = useRef(false)
  const chatEntry = location.state?.[CHAT_ENTRY] === true

  useEffect(() => {
    const before = previous.current
    previous.current = { key: location.key, drawerOpen }
    if (!mobile || covered) { opening.current = false; return }
    if (before.key !== location.key && navigationType === 'POP') {
      opening.current = false
      if (chatEntry) showConversation()
      else showHistory()
      return
    }
    if (before.drawerOpen && !drawerOpen && !chatEntry) opening.current = true
    if (drawerOpen || chatEntry) opening.current = false
    if (opening.current) {
      // The list and conversation share a route and the engine's selection.
      // Let the engine's route transition commit before adding its entry.
      const frame = requestAnimationFrame(() => {
        // BrowserRouter can commit its React location after the native URL.
        // A pending route will rerun this effect with the matching location.
        if ((window.history.state?.key ?? 'default') !== location.key) return
        opening.current = false
        void navigate(location.pathname + location.search + location.hash, {
          state: { ...location.state, [CHAT_ENTRY]: true }
        })
      })
      return () => cancelAnimationFrame(frame)
    }
  }, [mobile, drawerOpen, covered, location, navigationType, chatEntry, navigate, showHistory, showConversation])

  return () => {
    if (chatEntry) void navigate(-1)
    else showHistory()
  }
}
