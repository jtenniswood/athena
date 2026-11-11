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
  const previous = useRef({ location: null as typeof location | null, drawerOpen })
  const opening = useRef(false)
  const chatEntry = location.state?.[CHAT_ENTRY] === true
  const notificationRoute = new URLSearchParams(location.search).get('androidNotification') === '1'
  const backToHistory = () => {
    if (chatEntry) void navigate(-1)
    else showHistory()
  }

  useEffect(() => {
    if (!mobile || covered) return
    window.addEventListener('athena:open-notification', showConversation)
    return () => window.removeEventListener('athena:open-notification', showConversation)
  }, [mobile, covered, showConversation])

  useEffect(() => {
    if (!mobile || covered || drawerOpen || !notificationRoute) return
    // Android's Back can skip history entries created before the first touch.
    const onBack = (event: Event) => {
      event.preventDefault()
      backToHistory()
    }
    window.addEventListener('athena:native-back', onBack)
    return () => window.removeEventListener('athena:native-back', onBack)
  }, [mobile, covered, drawerOpen, notificationRoute, backToHistory])

  useEffect(() => {
    const before = previous.current
    previous.current = { location, drawerOpen }
    if (!mobile || covered) { opening.current = false; return }
    const routeChanged = before.location?.pathname !== location.pathname || before.location?.search !== location.search
    if (routeChanged && notificationRoute) {
      opening.current = false
      showConversation()
      return
    }
    if (before.location && before.location.key !== location.key && navigationType === 'POP') {
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
  }, [mobile, drawerOpen, covered, location, navigationType, chatEntry, notificationRoute, navigate, showHistory, showConversation])

  return backToHistory
}
