import { androidDismissActionMenu, androidOpenActionMenu, androidUpdateActionMenu, type AndroidActionMenu, type AndroidMenuGroup } from '../platform/android'

const rootSelector = '[data-slot="dropdown-menu-content"][data-state="open"], [data-slot="context-menu-content"][data-state="open"]'
const subSelector = '[data-slot="dropdown-menu-sub-content"][data-state="open"], [data-slot="context-menu-sub-content"][data-state="open"]'
const contentSelector = `${rootSelector}, ${subSelector}`
let nextMenu = 0
const swatchNames = ['Red', 'Orange', 'Yellow', 'Lime', 'Green', 'Mint', 'Cyan', 'Sky blue', 'Blue', 'Purple', 'Magenta', 'Pink']

/** Mirror mounted renderer commands; their original React owners still execute them. */
export function installNativeRendererMenus(searchSupported = false): () => void {
  let owner: HTMLElement | null = null
  let current: HTMLElement | null = null
  let menuId = ''
  let signature = ''
  let scheduled = false
  let disposed = false
  const ids = new WeakMap<HTMLElement, string>()
  const webOnly = new WeakSet<HTMLElement>()
  let nextItem = 0
  let page = 0
  let searchValue = ''
  const optionCommands = new Map<string, HTMLElement>()
  let commands = new Map<string, HTMLElement>()
  const hidden = new Set<HTMLElement>()
  const restore = () => { for (const node of hidden) node.removeAttribute('data-native-menu'); hidden.clear() }
  const release = () => {
    const id = menuId
    owner = null; current = null; menuId = ''; signature = ''; commands.clear(); optionCommands.clear(); page = 0; searchValue = ''; restore()
    if (id) void androidDismissActionMenu(id)
  }
  const enabled = (node: HTMLElement) => node.isConnected && !node.closest('[aria-disabled="true"],[data-disabled],[disabled]')
  const select = (id: string, value?: unknown) => {
    if (!owner?.isConnected || !current?.isConnected) return
    if (id === 'next-page' || id === 'previous-page') { page += id === 'next-page' ? 1 : -1; sync(); return }
    if (id === 'back') {
      current.dispatchEvent(new KeyboardEvent('keydown', {
        key: getComputedStyle(current).direction === 'rtl' ? 'ArrowRight' : 'ArrowLeft', bubbles: true
      }))
      return
    }
    const option = optionCommands.get(id)
    if (option && enabled(option) && option.closest(contentSelector) === current) {
      option.dispatchEvent(new KeyboardEvent('keydown', { key: getComputedStyle(option).direction === 'rtl' ? 'ArrowLeft' : 'ArrowRight', bubbles: true, cancelable: true }))
      return
    }
    const node = commands.get(id)
    if (node instanceof HTMLInputElement && enabled(node) && typeof value === 'string' && value.length <= 240 && node.isConnected && node.closest(contentSelector) === current) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(node, value)
      node.dispatchEvent(new Event('input', { bubbles: true }))
      node.dispatchEvent(new Event('change', { bubbles: true }))
      page = 0
      return
    }
    // Never activate a removed, disabled, or different menu's command.
    if (node && enabled(node) && node.closest(contentSelector) === current) node.click()
  }
  const closeWebMenu = () => {
    owner?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  }
  const sync = () => {
    scheduled = false
    if (disposed) return
    // Settings use their original web controls, including portalled menus.
    if (document.querySelector('[data-browser-settings-frame]')) { release(); return }
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
    const search = content.querySelector<HTMLInputElement>('[data-slot="dropdown-menu-search"] input')
    const searchable = Boolean(search && searchSupported)
    if (current !== content) page = 0
    if (search && search.value !== searchValue) { page = 0; searchValue = search.value }
    const allRows = [...content.querySelectorAll<HTMLElement>('[role^="menuitem"], button, [role="separator"], [data-slot$="menu-label"]')]
      .filter(node => node.closest(contentSelector) === content && !node.parentElement?.closest('[role^="menuitem"]'))
    if ((!allRows.length && !searchable) || content.querySelector('textarea, select, [contenteditable="true"]') || (content.querySelector('input') && !searchable)) {
      if (owner) { webOnly.add(root); release() }
      return
    }
    // Keep every catalog reachable within the existing bounded menu transport.
    const count = allRows.filter(row => row.matches('[role^="menuitem"],button')).length
    const pages = searchable ? Math.max(1, Math.ceil(count / 15)) : 1
    page = Math.max(0, Math.min(page, pages - 1))
    let index = 0
    const rows = allRows.filter(row => !row.matches('[role^="menuitem"],button') || !searchable || Math.floor(index++ / 15) === page)
    const nextCommands = new Map<string, HTMLElement>()
    optionCommands.clear()
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
      text.querySelectorAll('[aria-hidden="true"], kbd, [data-slot$="-shortcut"], button').forEach(node => node.remove())
      text.querySelectorAll('[data-slot="badge"]').forEach(node => node.before(document.createTextNode(' ')))
      let label = row.getAttribute('aria-label') || text.textContent?.trim() || ''
      if (!label && row.querySelector('[data-slot="skeleton"]')) label = 'Loading models…'
      if (!label) continue
      // The renderer's color buttons expose HSL as their default accessible
      // label. Keep the color visible and give its native control a plain name.
      const swatch = row.tagName === 'BUTTON' && row.style.backgroundColor && /^hsl\((\d+) 68% 58%\)$/.exec(label)
      const rgb = swatch ? getComputedStyle(row).backgroundColor.match(/^rgb\((\d+), (\d+), (\d+)\)$/) : null
      const color = rgb ? '#' + rgb.slice(1).map(value => Number(value).toString(16).padStart(2, '0')).join('') : undefined
      if (swatch) label = swatchNames[Math.round(Number(swatch[1]) / 30) % swatchNames.length]
      const single = Boolean(swatch) || row.getAttribute('role') === 'menuitemradio' || Boolean(searchable && row.querySelector('button[aria-pressed]'))
      if (group.items.length && (group.selection === 'single') !== single) {
        group = { items: [] }; groups.push(group)
      }
      if (single) group.selection = 'single'
      const toggle = row.querySelector<HTMLElement>('[role="switch"],[role="checkbox"],[role="radio"]')
      nextCommands.set(id, toggle || row)
      const favorite = searchable ? row.querySelector<HTMLElement>('button[aria-pressed]') : null
      const modelRow = Boolean(favorite && row.hasAttribute('aria-haspopup'))
      const children: AndroidMenuGroup[] | undefined = modelRow ? [{ items: [] }] : undefined
      if (favorite && children) {
        const favoriteId = `${id}:favorite`, optionsId = `${id}:options`
        nextCommands.set(favoriteId, favorite); optionCommands.set(optionsId, row)
        children[0].items.push({ id: favoriteId, label: favorite.getAttribute('aria-label') || 'Favorite', checked: favorite.getAttribute('aria-pressed') === 'true', keepOpen: true },
          { id: optionsId, label: 'Model options', submenu: true, keepOpen: true })
      }
      const checked = toggle?.getAttribute('aria-checked') ?? row.getAttribute('aria-checked')
      group.items.push({ id, label: label.slice(0, 240), disabled: !enabled(row),
        destructive: row.dataset.variant === 'destructive' || row.classList.contains('text-destructive'),
        submenu: !modelRow && row.hasAttribute('aria-haspopup'), children, selectable: modelRow || undefined,
        checked: modelRow ? Boolean(row.querySelector('.codicon-check')) : swatch ? Boolean(row.style.boxShadow) : checked === null ? undefined : checked === 'true',
        color,
        // Submenu triggers, check controls and embedded buttons update in place.
        keepOpen: searchable || row.hasAttribute('aria-haspopup') || checked !== null || row.tagName === 'BUTTON'
      })
    }
    if (searchable && search) {
      nextCommands.set('search', search)
      if (!groups.some(group => group.items.length)) groups.push({ items: [{id:'empty', label: content.textContent?.trim().slice(0,240) || 'No models', disabled:true}] })
      if (pages > 1) groups.push({ label: `${page + 1} / ${pages}`, items: [
        { id: 'previous-page', label: 'Previous page', disabled: page === 0, keepOpen: true },
        { id: 'next-page', label: 'Next page', disabled: page === pages - 1, keepOpen: true }
      ] })
    }
    if (!nextCommands.size) return
    if (!owner) { owner = root; menuId = `renderer-actions-${++nextMenu}` }
    current = content; commands = nextCommands
    const trigger = document.getElementById(content.getAttribute('aria-labelledby') || '')
    const bounds = root.getBoundingClientRect()
    const menu: AndroidActionMenu = { id: menuId,
      title: (content.getAttribute('aria-label') || trigger?.getAttribute('aria-label') || (content !== root ? trigger?.textContent?.trim() : '') || 'Actions').slice(0, 240),
      search: searchable && search ? { id:'search', value:search.value.slice(0,240), label:(search.placeholder || search.getAttribute('aria-label') || 'Search models').slice(0,240) } : undefined,
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
      void androidOpenActionMenu(menu, (selected, value) => { if (menuId === id) select(selected, value) }).then(result => {
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
  const observer = new MutationObserver(records => {
    if (!records.some(record => record.attributeName !== 'style' ||
      (record.target instanceof HTMLButtonElement && record.target.closest(contentSelector)))) return
    if (!scheduled) { scheduled = true; queueMicrotask(sync) }
  })
  observer.observe(document.body, { subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: ['data-state', 'aria-checked', 'aria-pressed', 'aria-disabled', 'disabled', 'data-disabled', 'aria-label', 'style'] })
  sync()
  return () => { disposed = true; observer.disconnect(); release() }
}
