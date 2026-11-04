const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)

function merge(base, incoming) {
  const result = structuredClone(base)
  for (const [key, value] of Object.entries(incoming)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Invalid config key')
    result[key] = isRecord(value) ? merge(isRecord(result[key]) ? result[key] : {}, value) : structuredClone(value)
  }
  return result
}

/** The synthetic backend's only config owner; REST and RPC share profile state. */
export function createPreviewConfig(profiles, model) {
  const saved = new Map(profiles.map(profile => [profile.name, {}]))
  const defaults = { model: { default: model, provider: 'custom' }, display: { show_reasoning: true }, terminal: {}, approvals: { mode: 'smart' } }
  const record = profile => {
    if (!saved.has(profile)) throw Object.assign(new Error('Unknown preview profile'), { status: 404 })
    return saved.get(profile)
  }
  const read = (profile = 'default', includeDefaults = true) => merge(includeDefaults ? defaults : {}, record(profile))
  const write = (profile, incoming) => {
    if (!isRecord(incoming)) throw Object.assign(new Error('Config must be an object'), { status: 422 })
    const next = merge(record(profile), incoming)
    if (next.approvals?.mode !== undefined && !['manual', 'smart', 'off'].includes(next.approvals.mode)) {
      throw Object.assign(new Error('Invalid approval mode'), { status: 422 })
    }
    saved.set(profile, next)
    return { ok: true }
  }
  return {
    read,
    write,
    defaults: () => structuredClone(defaults),
    schema: () => ({ fields: { 'display.show_reasoning': { type: 'boolean', description: 'Show reasoning in chat' } } }),
    set(profile, key, value) {
      if (key === 'approvals.mode' || key === 'approval_mode') {
        const mode = String(value ?? '').trim().toLowerCase()
        write(profile, { approvals: { mode } })
        return { key: 'approvals.mode', value: mode }
      }
      const word = String(value).trim().toLowerCase()
      const enabled = ['true', '1', 'yes', 'on'].includes(word)
      if (!enabled && !['false', '0', 'no', 'off'].includes(word)) throw new Error(`${key} takes true or false`)
      write(profile, { display: { [key.slice('display.'.length)]: enabled } })
      return { key, value: enabled }
    }
  }
}
