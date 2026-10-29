import { androidDismissSettingsPage, androidSettingsFiles, androidHost, androidOpenSettingsPage, androidUpdateSettingsPage, isAndroidApp, type AndroidSettingsPage, type AndroidSettingsRow } from '../platform/android'

const settingsSelector = '[data-browser-settings-frame]'
const controlSelector = 'button,a[href],input,textarea,select,summary,[role="switch"],[role="checkbox"],[role="radio"],[role="option"],[role="combobox"],[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"]'
const fieldSelector = '[id^="setting-field-"],[data-tour^="field-"],[class~="@container"]'
const choiceSelector = 'button[aria-pressed],[role="option"],[role="radio"],[role="tab"]'
const clean = (value: string | null | undefined, limit = 2000) => (value || '').replace(/\s+/g, ' ').trim().slice(0, limit)
function text(node: Element): string {
  const copy = node.cloneNode(true) as Element
  copy.querySelectorAll('svg,kbd,[aria-hidden="true"],script,style,input,textarea,select').forEach(item => item.remove())
  copy.querySelectorAll('div,p,li,span,h1,h2,h3,h4,h5,h6').forEach(item => item.append(' '))
  return clean(copy.textContent)
}
function visible(node: HTMLElement): boolean {
  return node.isConnected && !node.closest('[hidden],[inert],[aria-hidden="true"]') &&
    node.getClientRects().length > 0 && getComputedStyle(node).display !== 'none' && getComputedStyle(node).visibility !== 'hidden'
}
function fieldDescription(field: Element | null | undefined): string {
  return [...field?.querySelectorAll<HTMLElement>('.mt-1') || []]
    .filter(node => {
      const parent = node.parentElement?.closest('.mt-1')
      return visible(node) && !node.querySelector(controlSelector) && (!parent || !field?.contains(parent))
    })
    .map(text).join(' ')
}
function labelled(node: HTMLElement): string {
  const ids = node.getAttribute('aria-labelledby')?.split(/\s+/).map(id => document.getElementById(id)).filter(Boolean) as HTMLElement[] | undefined
  const labels = node instanceof HTMLInputElement || node instanceof HTMLSelectElement || node instanceof HTMLTextAreaElement ? [...node.labels || []].map(text).join(' ') : ''
  const field = node.closest(fieldSelector)
  const rowLabel = field?.querySelector('.font-medium > span, label')?.textContent
  const themeName = node.querySelector('.browser-color-theme-name')?.textContent
  const actionText = node.matches('button,a[href],summary,[role="option"],[role="radio"]') &&
    !node.matches('[role="switch"],[role="checkbox"],[role="combobox"]') ? text(node) : ''
  return clean(node.getAttribute('aria-label') || ids?.map(text).join(' ') || labels || themeName || actionText || rowLabel ||
    (node.matches('input,textarea,select') ? node.getAttribute('placeholder') : text(node)) || node.getAttribute('title') || 'Setting', 240)
}

/** Native presentation of mounted settings controls; React still owns values and saves. */
export function installNativeSettings(): () => void {
  if (!isAndroidApp()) return () => {}
  let disposed = false, supported = false, scheduled = 0, poll = 0
  let owner: HTMLElement | null = null, current: HTMLElement | null = null
  let pageId = '', signature = '', opening = false
  let nextId = 0, nextPage = 0
  const ids = new WeakMap<HTMLElement, string>()
  let commands = new Map<string, HTMLElement>()
  let observer: MutationObserver | undefined
  let closeButton: HTMLElement | null = null
  const id = (node: HTMLElement): string => {
    let value = ids.get(node)
    if (!value) { value = `control-${++nextId}`; ids.set(node, value) }
    commands.set(value, node)
    return value
  }
  const release = () => {
    const old = pageId
    owner?.removeAttribute('data-native-settings')
    owner = null; current = null; pageId = ''; signature = ''; commands.clear(); closeButton = null; opening = false
    if (old) void androidDismissSettingsPage(old)
  }
  const queue = () => { if (!scheduled && !disposed) scheduled = requestAnimationFrame(sync) }
  const command = async (key: string, value?: unknown) => {
    const root = owner, scope = current
    if (!root?.isConnected || !scope?.isConnected) return
    if (key === 'ready') { root.setAttribute('data-native-settings', ''); return }
    if (key === 'close') { closeButton?.click(); queue(); return }
    if (key === 'back') {
      const back = scope === root ? root.querySelector<HTMLElement>('.browser-settings-back') : null
      if (back && visible(back)) back.click()
      else if (scope === root) closeButton?.click()
      else (scope.querySelector<HTMLElement>('input,[tabindex="0"]') || scope).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      queue(); return
    }
    const node = commands.get(key)
    if (!node || !node.matches(controlSelector) || !visible(node) || node.matches(':disabled,[aria-disabled="true"],[data-disabled]') ||
      (!scope.contains(node) && !root.querySelector('.browser-settings-header')?.contains(node))) return
    const importFiles = (input: HTMLInputElement) => {
      void androidSettingsFiles(input.multiple).then(files => {
        if (!input.isConnected || owner !== root || current !== scope) return
        if (!files.length) { input.dispatchEvent(new Event('cancel', { bubbles: true })); return }
        const transfer = new DataTransfer()
        for (const file of files) {
          const bytes = Uint8Array.from(atob(file.data), character => character.charCodeAt(0))
          transfer.items.add(new File([bytes], file.name, { type: file.type }))
        }
        input.files = transfer.files
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
        queue()
      }).catch(() => {})
    }
    if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement) {
      if (node instanceof HTMLInputElement && node.type === 'file') importFiles(node)
      else if (node instanceof HTMLInputElement && ['checkbox', 'radio', 'button', 'submit', 'reset'].includes(node.type)) node.click()
      else {
        if (typeof value !== 'string' || value.length > 131072 || ((node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) && node.readOnly)) return
        if (node instanceof HTMLSelectElement && ![...node.options].some(option => option.value === value && !option.disabled)) return
        const prototype = node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
        Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(node, value)
        node.dispatchEvent(new Event('input', { bubbles: true }))
        node.dispatchEvent(new Event('change', { bubbles: true }))
        // Allow the controlled input owner to commit before its blur/save handler.
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
        if (node.isConnected && owner === root && current === scope) {
          node.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
          node.dispatchEvent(new FocusEvent('blur'))
        }
      }
    } else if (node instanceof HTMLAnchorElement) {
      // Use the current WebView's normal URL policy instead of opening a new window.
      const target = node.getAttribute('target'); node.removeAttribute('target')
      node.click()
      if (target) node.setAttribute('target', target)
    } else if (node.matches('[data-slot="select-trigger"]')) {
      node.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
    } else {
      // File inputs require browser user activation, which a bridge callback lacks.
      // Scope this interception to the originating settings action only.
      const click = HTMLInputElement.prototype.click
      HTMLInputElement.prototype.click = function () {
        if (this.type !== 'file') { click.call(this); return }
        importFiles(this)
      }
      try { node.click() } finally { HTMLInputElement.prototype.click = click }
    }
    queue()
  }
  function sync() {
    scheduled = 0
    if (disposed || !supported) return
    const root = document.querySelector<HTMLElement>(settingsSelector)
    if (owner && owner !== root) release()
    if (!root) return
    if (!owner) { owner = root; pageId = `settings-${++nextPage}` }
    const card = root.closest('.browser-settings-fullscreen-card') || root
    closeButton = [...card.querySelectorAll<HTMLElement>('button[aria-label]')].find(button =>
      button.getAttribute('aria-label') === root.dataset.browserSettingsCloseLabel) ||
      card.querySelector<HTMLElement>('.pointer-events-none button[aria-label],button[aria-label="Close settings"]')
    // Portalled dialogs and select lists are also native settings pages. Menus
    // already have their own native presenter and retain that lifecycle.
    const portals = [...document.querySelectorAll<HTMLElement>('[role="dialog"],[role="alertdialog"],[role="listbox"]')]
      .filter(node => !root.contains(node) && !node.contains(root) && visible(node) && !node.closest('[data-native-menu]'))
    current = portals.at(-1) || root
    const scope = current
    commands = new Map()
    const header = scope === root ? root.querySelector<HTMLElement>(':scope > .browser-settings-header') : null
    const title = clean(header?.querySelector('h1')?.textContent || scope.getAttribute('aria-label') ||
      scope.querySelector('h1,h2,[role="heading"]')?.textContent || 'Settings', 240)
    const search = header?.querySelector<HTMLElement>('.browser-settings-search button')
    const rows: AndroidSettingsRow[] = []
    const append = (row: AndroidSettingsRow) => { if (rows.length < 1000 && row.label) rows.push(row) }
    const walk = (node: Node) => {
      if (!(node instanceof HTMLElement) || !visible(node) || node === header || node.matches('script,style,svg,kbd,[aria-hidden="true"]')) return
      if (node.matches(controlSelector)) {
        const kind = node.getAttribute('role')
        let label = labelled(node)
        const disabled = node.matches(':disabled,[aria-disabled="true"],[data-disabled]') ||
          ((node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) && node.readOnly)
        const field = node.closest(fieldSelector)
        const described = node.getAttribute('aria-describedby')?.split(/\s+/).map(key => document.getElementById(key)?.textContent || '').join(' ') || fieldDescription(field) || node.querySelector('.browser-color-theme-description')?.textContent
        const fieldLabel = field?.querySelector('.font-medium > span')
        const valueTrigger = kind === 'combobox' || (node.hasAttribute('aria-haspopup') && fieldLabel &&
          [...field!.querySelectorAll<HTMLElement>(controlSelector)].filter(visible).length === 1)
        const summary = valueTrigger ? text(node) : ''
        if (valueTrigger && fieldLabel) label = text(fieldLabel)
        const choice = node.matches(choiceSelector)
        const exclusive = node.parentElement?.matches('.inline-grid,.browser-color-themes-mode,.browser-color-themes-grid,.browser-followup-options,[data-browser-profile-tabs],[role="listbox"],[role="radiogroup"]') || kind === 'radio' || kind === 'option'
        const variant = node.getAttribute('data-variant')
        const navigation = node.matches('.browser-settings-category-button')
        const presentation: AndroidSettingsRow['presentation'] = navigation ? 'navigation' : choice ? 'choice' :
          valueTrigger ? 'value' : variant === 'destructive' ? 'destructive' : variant === 'default' ? 'primary' : 'secondary'
        const base: Omit<AndroidSettingsRow, 'kind'> = { id: id(node), label, description: clean(choice && !node.querySelector('.browser-color-theme-description') ? '' : described, 1000) || undefined, disabled,
          presentation, group: choice && exclusive && node.parentElement ? id(node.parentElement) : undefined,
          icon: navigation ? node.dataset.nativeSettingsIcon : undefined }
        if (summary && summary !== label) base.value = summary
        if (node instanceof HTMLInputElement && node.type === 'hidden') return
        if (node instanceof HTMLSelectElement) append({ ...base, kind: 'select', value: node.value,
          options: [...node.options].map(option => ({ label: clean(option.label, 240) || 'None', value: option.value, disabled: option.disabled })) })
        else if ((choice && !exclusive) || (node instanceof HTMLInputElement && ['checkbox','radio'].includes(node.type)) || ['switch','checkbox','radio','menuitemcheckbox','menuitemradio'].includes(kind || ''))
          append({ ...base, kind: kind === 'radio' || (node instanceof HTMLInputElement && node.type === 'radio') ? 'radio' : 'toggle',
            checked: node instanceof HTMLInputElement ? node.checked : node.getAttribute('aria-checked') === 'true' || node.getAttribute('aria-pressed') === 'true' })
        else if ((node instanceof HTMLInputElement && !['file','button','submit','reset'].includes(node.type)) || node instanceof HTMLTextAreaElement) {
          const secret = node instanceof HTMLInputElement && node.type === 'password'
          append({ ...base, kind: 'input', inputType: node instanceof HTMLTextAreaElement ? 'textarea' : node.type,
            value: secret ? '' : node.value, disabled: disabled || node.value.length > 131072 })
        } else append({ ...base, kind: 'action', checked: node.getAttribute('aria-selected') === 'true' || node.getAttribute('aria-pressed') === 'true' || node.getAttribute('aria-checked') === 'true' })
        return
      }
      // The toolbar already presents the page title. Preserve its description once.
      if (node.matches('.browser-settings-home')) return
      if (/^H[1-6]$/.test(node.tagName) || node.getAttribute('role') === 'heading') { if (text(node) !== title && !node.matches('.browser-color-themes-heading h2')) append({ kind: 'heading', label: text(node) }); return }
      if (node.matches('.font-medium') && !node.querySelector(controlSelector)) {
        append({ kind: 'heading', label: text(node) }); return
      }
      const fields = node.matches(`label,${fieldSelector}`) ? [...node.querySelectorAll<HTMLElement>(controlSelector)].filter(visible) : []
      if (fields.length === 1 && !node.querySelector('h1,h2,h3,h4,h5,h6')) { walk(fields[0]); return }
      if (fields.length === 0 && node.matches(fieldSelector)) {
        const label = node.querySelector('.font-medium > span')
        if (label) {
          append({ kind: 'heading', label: text(label) })
          const remaining = node.cloneNode(true) as Element
          remaining.querySelector('.font-medium')?.remove()
          append({ kind: 'text', label: text(remaining) })
          return
        }
      }
      if (fields.length > 1 && fields.every(control => control.matches(choiceSelector))) {
        const label = node.querySelector('.font-medium > span')
        if (label) append({ kind: 'heading', label: text(label) })
        const description = fieldDescription(node)
        if (description) append({ kind: 'text', label: description })
        for (const control of fields) walk(control)
        return
      }
      if (node.hasAttribute('aria-label') && node.children.length > 1 &&
          [...node.children].every(child => child.matches(choiceSelector))) {
        const sectionHeading = node.closest('section')?.querySelector<HTMLElement>('h2,h3,h4')
        if (!sectionHeading || !visible(sectionHeading)) append({ kind: 'heading', label: clean(node.getAttribute('aria-label')) })
      }
      if (node.matches('p,[role="alert"],[role="status"]') && !node.querySelector(controlSelector)) { append({ kind: 'text', label: text(node) }); return }
      if (!node.querySelector(`${controlSelector},h1,h2,h3,h4,h5,h6,[role="heading"],.font-medium`)) { append({kind:'text',label:text(node)}); return }
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          const label = clean(child.textContent)
          if (label) append({ kind: 'text', label })
        } else walk(child)
      }
    }
    walk(scope)
    const model: AndroidSettingsPage = { id: pageId, scope: `${id(scope)}:${title}`, title, rows,
      search: search && visible(search) ? id(search) : undefined }
    const serialized = JSON.stringify(model)
    if (serialized === signature) return
    // The host has a separate bounded envelope for settings, including large
    // select lists. Do not truncate an editable value or silently save a prefix.
    if (serialized.length > 240000) { release(); return }
    signature = serialized
    if (!opening) {
      opening = true
      const requestId = pageId
      void androidOpenSettingsPage(model, (key, value) => { if (pageId === requestId) void command(key, value) })
        .then(() => { if (pageId === requestId) release() }).catch(() => { if (pageId === requestId) release() })
    } else void androidUpdateSettingsPage(model).then(ok => { if (!ok && owner === root) release() }).catch(release)
  }
  void androidHost().then(host => {
    if (disposed || !host?.capabilities.includes('settings-page')) return
    supported = true
    observer = new MutationObserver(queue)
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true,
      attributeFilter: ['hidden','disabled','readonly','aria-checked','aria-selected','aria-pressed','aria-disabled','data-state','value','class'] })
    // React can update input value properties without an attribute mutation.
    poll = window.setInterval(queue, 500)
    queue()
  })
  return () => { disposed = true; observer?.disconnect(); cancelAnimationFrame(scheduled); clearInterval(poll); release() }
}
