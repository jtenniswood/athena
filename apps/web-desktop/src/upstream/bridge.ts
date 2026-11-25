import { installBrowserDesktopBridge } from '@/lib/browser-desktop-bridge'
import { webappSessionKey } from '@/lib/browser-launch-session'
import { BROWSER_UPLOAD_MAX_BYTES } from '@/lib/browser-uploads'
import { tagRegistrySessionResponse } from '../../../desktop/electron/profile-session-routing'
import { assertSafeConnectionChange, beginOperation, setActiveWork } from '../platform/reload-safety'
import { beginBrowserTransition } from '../platform/browser-transition'
import { claimBrowserAmbientCue } from '../platform/ambient-claims'
import { browserSignInTarget } from '../platform/sign-in-target'
import { requestBrowserSessionCheck } from '../platform/session-recovery'
import { browserDefaultProfile } from '../platform/browser-default-profile'
import { createWebZoomBridge } from '../platform/display'
import { webNotify } from '../platform/notifications'
import { pickBrowserFiles, isWebFileHandle, registerWebFile, webFileAsDataUrl } from '../platform/files'
import { writeClipboard } from '../platform/clipboard'
import { mountedPluginFiles } from '../platform/plugin-files'
import { stopBrowserPush } from '../platform/browser-push'
import { androidPushGatewayUrl, resumeAndroidPush, stopAndroidPush } from '../platform/android-push'
import { buildInfo } from '../build-info'
import { openBrowserExternalLink } from './external-links'
import { standardGatewaySocket, type StandardSocket } from '../platform/standard-gateway'
import type { HermesApiRequest } from './types'
import { baseUrl, WEB_CONNECTION_ID, resolveToken, openOauthLoginPopup, fetchStatus, apiFetch,
  waitForRemoteRestart, loadStoredConnection, persistConnection, toConnectionConfig } from '../platform/connection'
import { activeUpstreamOrigin, normalizeBase, servingBase, syncDevGatewayCookie, withGatewayRoute } from '../web-bridge/gateways'

/** Translate only Athena's persisted owner identity; Hermes owns browser transport and services. */
function nativeOwner(connectionId?: string | null): 'local' {
  if (connectionId && ![WEB_CONNECTION_ID, 'local'].includes(connectionId)) throw new Error(`Unknown web connection: ${connectionId}`)
  return 'local'
}

const sharedStartupReadPaths = new Set(['/api/status', '/api/config', '/api/config/defaults', '/api/model/info'])

export function createWebBridge(): Window['hermesDesktop'] {
  // Athena verifies the session and saves drafts before navigating to sign-in.
  window.addEventListener('hermes:browser-reauth-required', event => {
    event.preventDefault()
    requestBrowserSessionCheck()
  })
  const token = resolveToken()
  if (token) sessionStorage.setItem(webappSessionKey(''), token)
  if (!installBrowserDesktopBridge()) throw new Error('The official Hermes Webapp bridge could not start.')
  let native = window.hermesDesktop
  let nativeToken = token
  let standardServer = false
  // Native methods capture their sign-in at installation; resolve them again after a credential change.
  const inherited = Object.fromEntries(Object.entries(native).map(([name, value]) => [name,
    typeof value === 'function' ? (...args: unknown[]) => Reflect.apply(Reflect.get(native, name), native, args) : value
  ])) as typeof native
  window.__HERMES_WEB_BRIDGE__ = true
  const listeners = new Set<() => void | Promise<void>>()
  const startupReads = new Map<string, Promise<unknown>>()
  const readStartup = async <T>(request: HermesApiRequest): Promise<T> => {
    const key = JSON.stringify([request.path, request.profile, request.connectionId,
      request.timeoutMs, request.passive, request.priority])
    let pending = startupReads.get(key)
    if (!pending) {
      pending = native.api(request).finally(() => {
        if (startupReads.get(key) === pending) startupReads.delete(key)
      })
      startupReads.set(key, pending)
    }
    // Each caller receives its own JSON data, as it would from a separate fetch.
    return structuredClone(await pending) as T
  }
  const upload = async <T>(work: () => Promise<T>): Promise<T> => {
    const finish = beginOperation()
    try { return await work() } finally { finish() }
  }
  const stageFile = (file: File) => upload(async () => {
    if (!standardServer) return native.stageFileForAttach!(file)
    if (file.size > BROWSER_UPLOAD_MAX_BYTES) throw new Error(`The file is larger than ${BROWSER_UPLOAD_MAX_BYTES / (1024 * 1024)} MiB, the largest file the browser can attach.`)
    return registerWebFile(file, file.name)
  })
  const ownedConnection = (connection: Awaited<ReturnType<typeof native.getConnection>>) => ({
    ...connection, connectionId: WEB_CONNECTION_ID, registryScoped: true, sharedRemote: true
  })
  const nativeSocket = async (dial: () => ReturnType<typeof native.getGatewayWsUrl>, profile?: string | null) => {
    try {
      const result = await dial()
      if (typeof result === 'string') return androidPushGatewayUrl(result)
      return result.ok ? { ...result, wsUrl: await androidPushGatewayUrl(result.wsUrl) } : result
    } catch (error) {
      if (/^404:/.test(error instanceof Error ? error.message : String(error))) {
        const url = await standardGatewaySocket('gateway', profile)
        standardServer = true
        return androidPushGatewayUrl(url)
      }
      throw error
    }
  }
  const bridge: Window['hermesDesktop'] = {
    ...inherited,
    ...mountedPluginFiles(() => native),
    glassSupported: false,
    translucencySupported: false,
    // The remote gateway does not control the browser's GPU.
    getRemoteDisplayReason: async () => null,
    zoom: createWebZoomBridge(),
    claimAmbientCue: claimBrowserAmbientCue,
    setActiveWork,
    notify: webNotify,
    openExternal: openBrowserExternalLink,
    openPreviewInBrowser: openBrowserExternalLink,
    // Preserve selection and dialog focus when the browser denies clipboard access.
    writeClipboard,
    getConnection: async profile => ownedConnection(await native.getConnection(profile)),
    getConnectionFor: async payload => ownedConnection(await native.getConnectionFor!({ ...payload, connectionId: nativeOwner(payload.connectionId) })),
    getProfileRoutes: async profiles => (await native.getProfileRoutes(profiles)).map(route => ({ ...route, connectionId: WEB_CONNECTION_ID, mode: 'remote' as const })),
    getAgentRoster: async () => {
      const roster = await native.getAgentRoster!()
      return { ...roster, primaryConnectionId: WEB_CONNECTION_ID,
        agents: roster.agents.map(agent => ({ ...agent, connectionId: WEB_CONNECTION_ID })),
        sources: roster.sources.map(source => ({ ...source, connectionId: WEB_CONNECTION_ID })) }
    },
    getGatewayWsUrl: profile => nativeSocket(() => native.getGatewayWsUrl(profile), profile),
    getGatewayWsUrlFor: payload => nativeSocket(() => native.getGatewayWsUrlFor!({ ...payload, connectionId: nativeOwner(payload.connectionId) }), payload.profile),
    getAudioWsUrl: async payload => {
      try { return await native.getAudioWsUrl!({ ...payload, connectionId: nativeOwner(payload.connectionId) }) }
      catch (error) {
        if (!/^404:/.test(error instanceof Error ? error.message : String(error))) throw error
        const socket = payload.path.endsWith('/speak-stream') ? 'speak-stream' : 'transcribe-stream'
        return standardGatewaySocket(socket as StandardSocket, payload.profile)
      }
    },
    getGatewayFileStreamUrl: payload => native.getGatewayFileStreamUrl!({ ...payload, connectionId: nativeOwner(payload.connectionId) }),
    saveGatewayFile: payload => native.saveGatewayFile!({ ...payload, connectionId: nativeOwner(payload.connectionId) }),
    // Athena's picker owns refusal, supersession and update blocking on both server surfaces.
    stageFileForAttach: stageFile,
    savePastedText: text => standardServer ? stageFile(new File([text], 'pasted.txt', { type: 'text/plain' })) : upload(() => native.savePastedText(text)),
    getStagedFileDisplayName: path => isWebFileHandle(path) ? path.split('/').at(-1) : native.getStagedFileDisplayName!(path),
    readFileDataUrl: path => isWebFileHandle(path) ? webFileAsDataUrl(path) : native.readFileDataUrl(path),
    readFileDataUrlForAttach: path => isWebFileHandle(path) ? webFileAsDataUrl(path) : native.readFileDataUrlForAttach!(path),
    saveImageBuffer: (data, ext) => upload(() => native.saveImageBuffer(data, ext)),
    saveClipboardImage: () => upload(() => native.saveClipboardImage()),
    selectPaths: async options => Promise.all((await pickBrowserFiles(options)).map(file => bridge.stageFileForAttach!(file))),
    api: async <T>(request: HermesApiRequest): Promise<T> => {
      const read = (request.method || 'GET').toUpperCase() === 'GET'
      const finish = read ? () => {} : beginOperation()
      if (!read) startupReads.clear()
      try {
        const share = read && request.body === undefined && !request.upload &&
          sharedStartupReadPaths.has(request.path.split('?')[0])
        const response = share ? await readStartup<T>(request) : await native.api<T>(request)
        return tagRegistrySessionResponse(request.path, response, WEB_CONNECTION_ID) as T
      } catch (error) {
        // A proxy can deny the request, redirect it across origins, or return a login page.
        if (error instanceof TypeError || (error instanceof Error && /^(?:401:|403:|Hermes API returned HTML)/.test(error.message))) {
          requestBrowserSessionCheck()
        }
        throw error
      } finally {
        // A read begun during a write must not be shared with a later caller.
        if (!read) startupReads.clear()
        finish()
      }
    },
    // Keep synced preferences and draft ownership through the transport migration.
    profile: { ...native.profile, getDefault: browserDefaultProfile.getDefault,
      setDefault: browserDefaultProfile.setDefault, onDefaultChanged: browserDefaultProfile.onDefaultChanged,
      get: async () => ({ profile: null }), remember: async profile => ({ profile }), set: async profile => ({ profile }) },
    getConnectionConfig: async () => toConnectionConfig(loadStoredConnection()),
    saveConnectionConfig: async input => toConnectionConfig(persistConnection(input)),
    applyConnectionConfig: async input => {
      const release = beginBrowserTransition()
      if (!release) throw new Error('Wait for the current page transition to finish.')
      try {
        await assertSafeConnectionChange()
        startupReads.clear()
        const next = persistConnection(input)
        const nextToken = resolveToken()
        if (nextToken !== nativeToken) {
          const host = window.hermesDesktop
          try {
            window.__HERMES_AUTH_REQUIRED__ = !nextToken
            if (nextToken) sessionStorage.setItem(webappSessionKey(''), nextToken)
            else sessionStorage.removeItem(webappSessionKey(''))
            Reflect.deleteProperty(window, 'hermesDesktop')
            if (!installBrowserDesktopBridge()) throw new Error('The Hermes Webapp sign-in could not be updated.')
            native = window.hermesDesktop
            nativeToken = nextToken
          } finally { window.hermesDesktop = host }
        }
        await native.revalidateConnection()
        await Promise.all([...listeners].map(callback => callback()))
        return await toConnectionConfig(next)
      } finally { release() }
    },
    onConnectionApplied: callback => { listeners.add(callback); return () => { listeners.delete(callback) } },
    oauthLoginConnectionConfig: async () => {
      startupReads.clear()
      syncDevGatewayCookie()
      try { return await openOauthLoginPopup(baseUrl(), activeUpstreamOrigin(), browserSignInTarget().path) }
      finally { startupReads.clear() }
    },
    oauthLogoutConnectionConfig: async () => {
      await stopAndroidPush()
      await stopBrowserPush()
      try {
        const response = await fetch(withGatewayRoute(`${baseUrl()}/auth/logout`, activeUpstreamOrigin()), { method: 'POST', credentials: 'same-origin', signal: AbortSignal.timeout(10_000) })
        if (!response.ok) throw new Error(`Sign-out failed (${response.status}). Try again.`)
        sessionStorage.removeItem(webappSessionKey(''))
        startupReads.clear()
        return { ok: true, connected: false }
      } catch (error) { await resumeAndroidPush(); throw error }
    },
    testConnectionConfig: async () => {
      const status = await fetchStatus(baseUrl())
      const result = await nativeSocket(() => native.getGatewayWsUrl())
      if (typeof result !== 'string' && !result.ok) throw new Error(result.error)
      return { baseUrl: baseUrl(), ok: true, version: status?.version ?? null }
    },
    recycleBackend: async profile => {
      await apiFetch({ method: 'POST', path: '/api/gateway/restart', profile: profile ?? undefined, timeoutMs: 10_000 })
      await waitForRemoteRestart()
      return { ok: true }
    },
    getVersion: async () => {
      const status = await fetchStatus(normalizeBase(servingBase())).catch(() => null)
      return { appVersion: `web-${buildInfo.wrapperRevision.slice(0, 12)}`, backendVersion: status?.version || '',
        rendererRevision: buildInfo.rendererRevision, electronVersion: '', nodeVersion: '', platform: 'web', hermesRoot: '' }
    }
  }
  // Athena installs window commands after engine registration, including Android's single-window policy.
  delete (bridge as Partial<Window['hermesDesktop']>).openWindow
  delete (bridge as Partial<Window['hermesDesktop']>).openSessionWindow
  delete (bridge as Partial<Window['hermesDesktop']>).terminal
  // Athena's account-scoped store owns preference hydration and guarded application.
  delete (bridge as Partial<Window['hermesDesktop']>).uiPreferences
  return bridge
}
