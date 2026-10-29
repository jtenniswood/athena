import { androidDismissActionMenu, androidOpenActionMenu, androidUpdateActionMenu, type AndroidActionMenu, type AndroidMenuGroup } from '../platform/android'

const rootSelector = '[data-slot="dropdown-menu-content"][data-state="open"], [data-slot="context-menu-content"][data-state="open"]'
const subSelector = '[data-slot="dropdown-menu-sub-content"][data-state="open"], [data-slot="context-menu-sub-content"][data-state="open"]'
const contentSelector = `${rootSelector}, ${subSelector}`
let nextMenu = 0

/** Mirror mounted renderer commands; their original React owners still execute them. */
export function installNativeRendererMenus(): () => void {
  let owner: HTMLElement | null = null
  let current: HTMLElement | null = null
  let menuId = ''
  let signature = ''
  let scheduled = false
  let disposed = false
  const ids = new WeakMap<HTMLElement, string>()
  const webOnly = new WeakSet<HTMLElement>()
  let nextItem = 0
  let commands = new Map<string, HTMLElement>()
  const hidden = new Set<HTMLElement>()
  const restore = () => { for (const node of hidden) node.removeAttribute('data-native-menu'); hidden.clear() }
  const release = () => {
    const id = menuId
    owner = null; current = null; menuId = ''; signature = ''; commands.clear(); restore()
    if (id) void androidDismissActionMenu(id)
  }
  const enabled = (node: HTMLElement) => node.isConnected && node.getAttribute('aria-disabled') !== 'true' && !node.hasAttribute('data-disabled') && !node.hasAttribute('disabled')
  const select = (id: string) => {
    if (!owner?.isConnected || !current?.isConnected) return
    if (id === 'back') {
      current.dispatchEvent(new KeyboardEvent('keydown', {
        key: getComputedStyle(current).direction === 'rtl' ? 'ArrowRight' : 'ArrowLeft', bubbles: true
      }))
      return
    }
    const node = commands.get(id)
    // Never activate a removed, disabled, or different menu's command.
    if (node && enabled(node) && node.closest(contentSelector) === current) node.click()
  }
  const closeWebMenu = () => {
    owner?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  }
  const sync = () => {
    scheduled = false
    if (disposed) return
    if (owner && (!owner.isConnected || owner.dataset.state !== 'open')) release()
    const root = owner ?? [...document.querySelectorAll<HTMLElement>(rootSelector)].find(node => !webOnly.has(node) && !node.hasAttribute('data-browser-action-surface'))
    if (!root) return
    const submenus = [...document.querySelectorAll<HTMLElement>(subSelector)]
    // Follow aria-labelledby back to this root, excluding unrelated portals.
    const belongs = (node: HTMLElement): boolean => {
      const trigger = document.getElementById(node.getAttribute('aria-labelledby') || '')
      const parent = trigger?.closest<HTMLElement>(contentSelector)
      return parent === root || Boolean(parent && parent !== node && submenus.includes(parent) && belongs(parent))
    }
    const content = submenus.filter(belongs).at(-1) ?? root
    const rows = [...content.querySelectorAll<HTMLElement>('[role^="menuitem"], button, [role="separator"], [data-slot$="menu-label"]')]
      .filter(node => node.closest(contentSelector) === content && !node.parentElement?.closest('[role^="menuitem"]'))
    if (!rows.length || content.querySelector('input, textarea, select, [contenteditable="true"]')) {
      if (owner) { webOnly.add(root); release() }
      return
    }
    const nextCommands = new Map<string, HTMLElement>()
    const groups: AndroidMenuGroup[] = []
    let group: AndroidMenuGroup = { items: [] }
    groups.push(group)
    for (const row of rows) {
      if (row.getAttribute('role') === 'separator' || row.dataset.slot?.endsWith('menu-label')) {
        group = { label: row.getAttribute('role') === 'separator' ? undefined : row.textContent?.trim().slice(0, 160), items: [] }
        groups.push(group)
        continue
      }
      let id = ids.get(row)
      if (!id) { id = `item-${++nextItem}`; ids.set(row, id) }
      const text = row.cloneNode(true) as HTMLElement
      text.querySelectorAll('[aria-hidden="true"], kbd, [data-slot$="-shortcut"]').forEach(node => node.remove())
      const label = row.getAttribute('aria-label') || text.textContent?.trim() || ''
      if (!label) continue
      const single = row.getAttribute('role') === 'menuitemradio'
      if (group.items.length && (group.selection === 'single') !== single) {
        group = { items: [] }; groups.push(group)
      }
      if (single) group.selection = 'single'
      nextCommands.set(id, row)
      const checked = row.getAttribute('aria-checked')
      group.items.push({ id, label: label.slice(0, 240), disabled: !enabled(row),
        destructive: row.dataset.variant === 'destructive' || row.classList.contains('text-destructive'),
        submenu: row.hasAttribute('aria-haspopup'),
        checked: checked === null ? undefined : checked === 'true',
        // Submenu triggers, check controls and embedded buttons update in place.
        keepOpen: row.hasAttribute('aria-haspopup') || checked !== null || row.tagName === 'BUTTON'
      })
    }
    if (!nextCommands.size) return
    if (!owner) { owner = root; menuId = `renderer-actions-${++nextMenu}` }
    current = content; commands = nextCommands
    const trigger = document.getElementById(content.getAttribute('aria-labelledby') || '')
    const bounds = root.getBoundingClientRect()
    const menu: AndroidActionMenu = { id: menuId,
      title: (content.getAttribute('aria-label') || trigger?.getAttribute('aria-label') || (content !== root ? trigger?.textContent?.trim() : '') || 'Actions').slice(0, 240),
      compact: true, x: bounds.left, y: bounds.top, viewportWidth: window.innerWidth,
      groups: groups.filter(group => group.items.length), backId: content === root ? undefined : 'back'
    }
    const nextSignature = JSON.stringify(menu)
    if (signature === nextSignature) return
    const opening = !signature
    signature = nextSignature
    for (const node of [root, ...submenus.filter(belongs)]) { node.setAttribute('data-native-menu', ''); hidden.add(node) }
    const id = menuId
    if (opening) {
      void androidOpenActionMenu(menu, selected => { if (menuId === id) select(selected) }).then(result => {
        if (menuId !== id) return
        if (result.status === 'selected') select(result.id)
        if (result.status !== 'unavailable') closeWebMenu()
        else webOnly.add(root)
        release()
      })
    } else {
      void androidUpdateActionMenu(menu).then(ok => { if (!ok && menuId === id) { webOnly.add(root); release() } })
    }
  }
  const observer = new MutationObserver(() => {
    if (!scheduled) { scheduled = true; queueMicrotask(sync) }
  })
  observer.observe(document.body, { subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: ['data-state', 'aria-checked', 'aria-disabled', 'disabled', 'data-disabled', 'aria-label'] })
  sync()
  return () => { disposed = true; observer.disconnect(); release() }
}
