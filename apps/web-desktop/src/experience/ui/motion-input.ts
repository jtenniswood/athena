/** Pointer motion is optional; keyboard commands always respond immediately. */
export function installBrowserMotionInput(): () => void {
  const root = document.documentElement
  const pointer = () => { root.dataset.browserInput = 'pointer' }
  const keyboard = (event: KeyboardEvent) => {
    if (!['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) root.dataset.browserInput = 'keyboard'
  }
  root.dataset.browserInput = 'keyboard'
  document.addEventListener('pointerdown', pointer, true)
  document.addEventListener('keydown', keyboard, true)
  return () => {
    document.removeEventListener('pointerdown', pointer, true)
    document.removeEventListener('keydown', keyboard, true)
    delete root.dataset.browserInput
  }
}
