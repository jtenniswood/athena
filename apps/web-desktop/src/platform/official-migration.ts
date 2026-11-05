const modelKeys = ['model', 'provider', 'model-source', 'reasoning-effort', 'fast', 'service-tier']

/** Copy model choices to the released host's owner; retain originals for rollback. */
export function migrateOfficialComposerPreferences(storage: Storage, origin: string): void {
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter((key): key is string => key !== null)
  for (const name of modelKeys) {
    const prefix = `hermes.desktop.composer.${name}.registry.web-single.`
    for (const key of keys.filter(key => key.startsWith(prefix))) {
      const value = storage.getItem(key)
      if (value === null) continue
      const profile = key.slice(prefix.length)
      for (const scope of [`registry.local.${profile}`, `remote.${encodeURIComponent(origin)}.${profile}`]) {
        const target = `hermes.desktop.composer.${name}.${scope}`
        if (storage.getItem(target) === null) storage.setItem(target, value)
      }
    }
  }
}
