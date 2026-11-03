import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { installNativeSettings } from '../../../apps/web-desktop/src/upstream/native-settings'
import { useSettingsFramePresentation, useSettingsPresentation } from '../../../apps/web-desktop/src/experience/settings/presentation'
import { useBrowserConfigFieldPresentation } from '../../../apps/web-desktop/src/upstream/config-field-presentation'
import { createBrowserSettingsSaveOwner } from '../../../apps/web-desktop/src/platform/settings-save'
import { flushPendingBrowserWork } from '../../../apps/web-desktop/src/platform/pending-work'

const fixture = window as typeof window & {
  AthenaAndroid: { onmessage: null | ((event: { data: string }) => void); postMessage(raw: string): void }
  nativeModels: { id: string; scope: string; title: string; rows: { id?: string; label: string; value?: string; checked?: boolean }[] }[]
  nativeReady: boolean
  nativeCommand(id: string, value?: unknown): void
  holdSave: boolean
  failSave: boolean
  finishSave?: () => void
  prepare(): Promise<unknown>
  saved: string[]
}
fixture.nativeModels = []
fixture.saved = []
let nativeRequest = ''
const reply = (id: string, value: unknown) => queueMicrotask(() => fixture.AthenaAndroid.onmessage?.({ data: JSON.stringify({ id, value }) }))
fixture.AthenaAndroid = {
  onmessage: null,
  postMessage(raw) {
    const { id, method, payload } = JSON.parse(raw)
    if (method === 'hello') reply(id, { protocol: 1, capabilities: ['settings-page'], appVersion: 'fixture', insets: 'native', typography: 'platform' })
    else if (method === 'settingsPage') {
      nativeRequest = id; fixture.nativeModels.push(payload)
      reply(id, { status: 'changed', id: 'ready' })
    } else if (method === 'updateSettingsPage') { fixture.nativeModels.push(payload); reply(id, true) }
    else if (method === 'dismissSettingsPage') { reply(nativeRequest, { status: 'dismissed' }); reply(id, true) }
    else reply(id, false)
  }
}
fixture.nativeCommand = (id, value) => reply(nativeRequest, { status: 'changed', id, value })
fixture.prepare = flushPendingBrowserWork
const stopNative = installNativeSettings()
if (import.meta.hot) import.meta.hot.dispose(stopNative)

function ProfileSettings({ profile }: { profile: string }) {
  const [name, setName] = useState(profile + ' name')
  const [secret, setSecret] = useState('private-fixture-secret')
  const [enabled, setEnabled] = useState(true)
  const [disabled, setDisabled] = useState(false)
  const [save] = useState(() => createBrowserSettingsSaveOwner('fixture-settings', 550))
  const commitName = (value: unknown) => {
    const next = String(value)
    setName(next)
    save.schedule(async () => {
      if (fixture.holdSave) await new Promise<void>(resolve => { fixture.finishSave = resolve })
      if (fixture.failSave) throw Error('Synthetic save failure')
      fixture.saved.push(`${profile}:${next}`)
    })
  }
  const metadata = { parseList: (raw: string) => raw.split(',').map(value => value.trim()).filter(Boolean), prettyName: (value: string) => value,
    emptyLabel: 'None', defaultLabel: 'Default', extended: false }
  const nameRef = useBrowserConfigFieldPresentation({ ...metadata, schemaKey: 'display.name', schema: { type: 'string' }, label: 'Display name', value: name, onChange: commitName })
  const enabledRef = useSettingsPresentation<HTMLLabelElement>([{ id: 'enabled', kind: 'toggle', label: 'Enabled', checked: enabled,
    disabled, run: () => setEnabled(!enabled) }])
  const secretRef = useSettingsPresentation<HTMLLabelElement>([{ id: 'secret', kind: 'input', inputType: 'password', label: 'Secret', value: secret,
    run: value => setSecret(String(value)) }])
  return <>
    <div ref={nameRef}><label>Display name<input value={name} onChange={event => commitName(event.target.value)} /></label></div>
    <label ref={enabledRef}>Enabled<input type="checkbox" checked={enabled} disabled={disabled} onChange={event => setEnabled(event.target.checked)} /></label>
    <label ref={secretRef}>Secret<input type="password" value={secret} onChange={event => setSecret(event.target.value)} /></label>
    <button onClick={() => setDisabled(!disabled)}>Change availability</button>
  </>
}

function Settings() {
  const [profile, setProfile] = useState('A')
  const [mounted, setMounted] = useState(true)
  const root = useSettingsFramePresentation({ scope: profile, title: `${profile} settings`, close: () => setMounted(false), back: () => setMounted(false) })
  return <>
    <button onClick={() => setProfile(profile === 'A' ? 'B' : 'A')}>Switch profile</button>
    <button onClick={() => setMounted(!mounted)}>Toggle Settings</button>
    {mounted && <div ref={root} data-browser-settings-frame=""><ProfileSettings key={profile} profile={profile} /></div>}
  </>
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><Settings /></React.StrictMode>)
