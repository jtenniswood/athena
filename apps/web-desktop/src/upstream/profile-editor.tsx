import { useEffect, useState } from 'react'
import { useStore } from '@nanostores/react'
import { $profiles, refreshActiveProfile } from '@/store/profile'
import { CreateProfileDialog } from '@/app/profiles/create-profile-dialog'
import { $lastRoster } from '@/plugins/hermes-bots/data'
import { requestForBot } from '@/plugins/hermes-bots/routing'
import { WEB_CONNECTION_ID } from '../platform/connection'
import { ensureBotMetadata } from '@/plugins/hermes-bots/canonical-chat'
import { EditProfileDialog } from '@/plugins/hermes-bots/edit-profile-dialog'
import type { RosterRow } from '@/plugins/hermes-bots/types'
import { reportActionFailure } from '../experience/action-errors'

export function BrowserProfileCreator({ open, onClose, onCreated }: { open: boolean; onClose(): void; onCreated(profile: string): void }) {
  const profiles = useStore($profiles)
  return <CreateProfileDialog open={open} onClose={onClose} profiles={profiles} onCreated={async profile => {
    await refreshActiveProfile()
    onCreated(profile)
  }} />
}

/** Open the existing bot editor without selecting its profile or conversation. */
export function BrowserProfileEditor({ profile, onClose }: { profile: string | null; onClose(): void }) {
  const [editing, setEditing] = useState<RosterRow | null>(null)
  useEffect(() => {
    let cancelled = false
    setEditing(null)
    if (!profile) return
    const row = $lastRoster.get().find(bot => bot.name === profile || bot.targetProfile === profile || bot.route?.targetProfile === profile)
    // Profile editing also works before the shared profile metadata has loaded.
    const bot: RosterRow = row ?? {
      ...$profiles.get().find(item => item.name === profile),
      name: profile,
      sourceScoped: true,
      route: { connectionId: WEB_CONNECTION_ID, mode: 'remote', profile, targetProfile: profile }
    }
    const prepare = async () => {
      let target = bot
      if (!row) {
        const result = await requestForBot<{ profiles?: RosterRow[] }>(bot, 'profiles.list', {})
        const details = result.profiles?.find(item => item.name === profile)
        if (details) target = { ...details, sourceScoped: true, route: bot.route }
      }
      await ensureBotMetadata(target)
      return target
    }
    void prepare().then(target => {
      if (!cancelled) setEditing(target)
    }).catch(() => {
      if (cancelled) return
      reportActionFailure('Could not load profile for editing.')
      onClose()
    })
    return () => { cancelled = true }
  }, [profile])
  return <EditProfileDialog bot={editing} open={Boolean(editing && profile)} onClose={onClose} />
}
