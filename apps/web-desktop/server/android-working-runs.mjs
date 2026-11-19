// Match starts to prompts submitted by this installation. Watching or replaying
// a conversation belonging to another client must not create a Live Update.
export function androidWorkingRuns({ sessionFor, onStart, onEnd }) {
  const requests = new Map()
  const admitted = new Map()
  const starts = new Map()
  const active = new Map()

  function remember(map, key, value) {
    if (map.size >= 128) map.delete(map.keys().next().value)
    map.set(key, value)
  }

  function start(key) {
    const target = admitted.get(key)
    const event = starts.get(key)
    if (!target || !event || active.has(key)) return
    admitted.delete(key)
    starts.delete(key)
    const run = onStart(event, target)
    if (run) active.set(key, { run, turn: event.payload?.turn_id })
  }

  return {
    request(frame) {
      if (frame.method !== 'prompt.submit' || frame.id == null || typeof frame.params?.session_id !== 'string') return
      remember(requests, frame.id, { session: frame.params.session_id, profile: frame.params.profile })
    },
    response(frame) {
      const request = requests.get(frame.id)
      if (!request) return
      requests.delete(frame.id)
      const result = frame.result
      if (!result || request.finished) return
      const canonical = typeof result.admission_id === 'string' && ['queued', 'started'].includes(result.status)
      if (!canonical && result.status !== 'streaming') return
      const key = canonical ? 'admission:' + result.admission_id : 'session:' + request.session
      if (starts.get(key) === null) return
      const session = sessionFor(request.session)
      const id = result.ref?.session_id || session?.id || request.session
      remember(admitted, key, { id, profile: request.profile || session?.profile })
      start(key)
    },
    event(event) {
      if (typeof event.session_id !== 'string') return
      const canonical = typeof event.admission_id === 'string'
      const key = canonical ? 'admission:' + event.admission_id : 'session:' + event.session_id
      if (event.type === 'message.start') {
        if (active.has(key) || starts.get(key) === null) return
        if (admitted.has(key) || [...requests.values()].some(request => request.session === event.session_id)) {
          remember(starts, key, event)
          start(key)
        }
      } else if (event.type === 'message.complete') {
        if (canonical && [...requests.values()].some(request => request.session === event.session_id)) {
          // The owner can publish both events before its prompt.submit receipt.
          remember(starts, key, null)
        } else {
          if (!canonical && starts.has(key)) {
            for (const request of requests.values()) {
              if (request.session === event.session_id) request.finished = true
            }
          }
          starts.delete(key)
        }
        admitted.delete(key)
        const current = active.get(key)
        if (current && (canonical || !current.turn || current.turn === event.payload?.turn_id)) {
          active.delete(key)
          onEnd(current.run)
        }
      }
    },
    hasActive() { return active.size > 0 },
    close() {
      for (const { run } of active.values()) onEnd(run)
      active.clear()
    }
  }
}
