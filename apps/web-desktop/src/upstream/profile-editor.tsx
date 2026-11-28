import { useEffect, useState } from 'react'
import { useStore } from '@nanostores/react'
import { $profiles, refreshActiveProfile } from '@/store/profile'
import { CreateProfileDialog } from '@/app/profiles/create-profile-dialog'
import { $lastRoster } from '@/plugins/hermes-bots/data'
import { requestForBot } from '@/plugins/hermes-bots/routing'
import { mergeServerMeta } from '@/plugins/hermes-bots/profile-ops'
import { EditProfileDialog } from '@/plugins/hermes-bots/edit-profile-dialog'
import type { RosterRow } from '@/plugins/hermes-bots/types'
import { reportActionFailure } from '../experience/action-errors'
import { browserProfileRosterRow, browserProfileRow, loadBrowserProfileAvatar } from './profile-avatars'

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
    const bot = browserProfileRosterRow($lastRoster.get(), profile) ?? browserProfileRow(profile)
    const prepare = async () => {
      const fetchedAt = Date.now()
      const result = await requestForBot<{ profiles?: RosterRow[] }>(bot, 'profiles.list', {})
      const profileName = bot.route?.targetProfile ?? bot.name
      const details = result.profiles?.find(item => item.name === profileName)
      const target = details ? { ...bot, ...details, name: bot.name, sourceScoped: bot.sourceScoped, route: bot.route } : bot
      if (cancelled) return target
      mergeServerMeta([target], fetchedAt)
      await loadBrowserProfileAvatar(target)
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
