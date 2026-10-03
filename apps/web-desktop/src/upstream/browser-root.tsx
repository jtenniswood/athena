import { BrowserShell } from '../experience/browser-shell'
import { useEffect } from 'react'
import { restoreBrowserProfile } from './profiles'
import { setReasoningCollapsedByDefault } from '@/store/reasoning-disclosure'
import { setTipsEnabled } from '@/store/tips'
import { setToursEnabled } from '@/store/tours'
import './browser-initialize'
import '../experience/browser.css'
export default function BrowserRoot() {
  useEffect(() => {
    const stopRestoringProfile = restoreBrowserProfile()
    setTipsEnabled(false)
    setToursEnabled(false)
    setReasoningCollapsedByDefault(true)
    return stopRestoringProfile
  }, [])
  return <BrowserShell />
}
