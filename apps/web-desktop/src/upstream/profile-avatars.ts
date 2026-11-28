import { host } from '@hermes/plugin-sdk'
import { isBackfilledFacePng } from '@/plugins/hermes-bots/avatar-image'
import { $botMeta, $lastRoster, botMetaKey, botMetaWriteAt, cachedUnionRoster, primeRoster, setLocalBotMeta } from '@/plugins/hermes-bots/data'
import { mergeServerMeta } from '@/plugins/hermes-bots/profile-ops'
import type { RosterRow } from '@/plugins/hermes-bots/types'
import { WEB_CONNECTION_ID } from '../platform/connection'

// Athena exposes one gateway. Use the same identity before the roster loads
// and when its rows are missing route annotations.
export function browserProfileRow(name: string): RosterRow {
  return {
    name,
    connectionId: WEB_CONNECTION_ID,
    sourceScoped: true,
    route: { connectionId: WEB_CONNECTION_ID, mode: 'remote', profile: name, targetProfile: name }
  }
}

export function browserProfileRosterRow(roster: readonly RosterRow[], profile: string): RosterRow | undefined {
  return roster.find(row => row.name === profile || row.targetProfile === profile || row.route?.targetProfile === profile)
}

export async function publishBrowserProfileRoster(signal: AbortSignal): Promise<void> {
  await primeRoster()
  if (signal.aborted) return
  const snapshot = cachedUnionRoster()
  if (!snapshot?.profiles) return
  const rows = snapshot.profiles.filter(row => !row.ghost && !row.remoteSource).map(row =>
    row.sourceScoped ? row : { ...row, ...browserProfileRow(row.name) })
  mergeServerMeta(rows, snapshot.fetchedAt)
  $lastRoster.set(rows)
  for (const row of rows) void loadBrowserProfileAvatar(row)
}

const avatarRequests = new Map<string, Promise<void>>()

export async function loadBrowserProfileAvatar(row: RosterRow): Promise<void> {
  const key = botMetaKey(row)
  const metadata = $botMeta.get()
  const current = metadata[key]
  if (current?.image) return

  // Name-keyed images from older Athena installs belong to this same gateway.
  // An explicit scoped clear takes precedence over an older local image.
  const legacy = metadata[row.name]
  if (current?.image === undefined && legacy?.image) {
    await setLocalBotMeta(row, { image: legacy.image, imageKind: legacy.imageKind })
    return
  }
  if (!row.has_avatar) return

  const pending = avatarRequests.get(key)
  if (pending) return pending
  const lastWrite = botMetaWriteAt.get(key)
  const request = host.request<{ found?: boolean; data?: string }>('profiles.get_asset', {
    name: row.route?.targetProfile || row.targetProfile || row.name,
    asset: 'avatar'
  }).then(async asset => {
    if (!asset?.found || !asset.data || botMetaWriteAt.get(key) !== lastWrite) return
    const latest = $botMeta.get()[key]
    if (latest?.image !== current?.image) return
    // The gateway can also store a raster of the default animated face.
    if (isBackfilledFacePng(asset.data) && latest?.imageKind !== 'photo' && !latest?.pet) return
    await setLocalBotMeta(row, { image: asset.data })
  }).catch(() => undefined).finally(() => avatarRequests.delete(key))
  avatarRequests.set(key, request)
  await request
}
