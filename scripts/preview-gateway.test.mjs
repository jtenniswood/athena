import assert from 'node:assert/strict'
import { once } from 'node:events'
import { test } from 'node:test'
import WebSocket from 'ws'
import { createPreviewGateway } from './preview/gateway.mjs'

async function fixture(t) {
  const gateway = createPreviewGateway({ strict: true })
  await new Promise(resolve => gateway.server.listen(0, '127.0.0.1', resolve))
  t.after(() => gateway.close())
  const origin = `http://127.0.0.1:${gateway.server.address().port}`
  const socket = new WebSocket(origin.replace('http:', 'ws:') + '/api/ws?profile=research')
  await once(socket, 'open')
  let id = 0
  const request = (method, params = {}) => {
    const requestId = ++id
    return new Promise(resolve => {
      const receive = data => {
        const reply = JSON.parse(String(data))
        if (reply.id === requestId) { socket.off('message', receive); resolve(reply) }
      }
      socket.on('message', receive)
      socket.send(JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }))
    })
  }
  return { ...gateway, origin, socket, request }
}

test('native browser preference hydration retains a peer value during seeding and supports deletion', async t => {
  const gateway = await fixture(t)
  const endpoint = `${gateway.origin}/api/ui-preferences`
  assert.equal((await (await fetch(endpoint)).json()).exists, false)
  const write = async body => (await fetch(endpoint, { method: 'PATCH',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json()
  await write({ values: { theme: 'dark', temporary: 'kept' } })
  const seeded = await write({ seed: true, values: { theme: 'light', density: 'compact' } })
  assert.deepEqual(seeded.values, { theme: 'dark', temporary: 'kept', density: 'compact' })
  const removed = await write({ values: { temporary: null } })
  assert.equal(removed.exists, true)
  assert.deepEqual(removed.values, { theme: 'dark', density: 'compact' })
  gateway.controls.assertExpected()
})

test('synthetic redirect accepts an active correction and rejects an idle session', async t => {
  const gateway = await fixture(t)
  const params = { session_id: 'preview-week', text: 'Change direction' }
  assert.equal((await gateway.request('session.redirect', params)).result.status, 'rejected')
  await gateway.request('prompt.submit', { session_id: params.session_id, text: 'Start a response' })
  assert.equal((await gateway.request('session.redirect', params)).result.status, 'redirected')
  assert.ok(gateway.messages.get(params.session_id).some(row => row.content === params.text && row.display_kind === 'steer'))
  gateway.controls.assertExpected()
})

test('RPC holds allow later selections to complete first without timing guesses', async t => {
  const gateway = await fixture(t)
  const held = gateway.controls.hold(call => call.method === 'session.resume' && call.params.session_id === 'preview-research')
  let finished = false
  const first = gateway.request('session.resume', { session_id: 'preview-research' }).then(reply => { finished = true; return reply })
  await held.entered
  const second = await gateway.request('session.resume', { session_id: 'preview-writer' })
  assert.equal(second.result.stored_session_id, 'preview-writer')
  assert.equal(finished, false)
  held.release()
  assert.equal((await first).result.stored_session_id, 'preview-research')
  gateway.controls.assertExpected()
})

test('the released MCP health sweep sees an empty synthetic server roster', async t => {
  const gateway = await fixture(t)
  assert.deepEqual((await gateway.request('mcp.servers.status')).result, { servers: [] })
  gateway.controls.assertExpected()
})

test('the renderer title command persists only the addressed conversation', async t => {
  const gateway = await fixture(t)
  const original = gateway.sessions.get('preview-idea').title
  const reply = await gateway.request('session.title', { session_id: 'preview-week', title: 'A renamed conversation' })
  assert.equal(reply.result.title, 'A renamed conversation')
  assert.equal((await (await fetch(gateway.origin + '/api/sessions/preview-week')).json()).title, 'A renamed conversation')
  assert.equal(gateway.sessions.get('preview-idea').title, original)
  gateway.controls.assertExpected()
})

test('rejected REST mutations leave sessions intact and consume the fault once', async t => {
  const gateway = await fixture(t)
  const path = '/api/sessions/preview-week'
  gateway.controls.reject({ transport: 'http', method: 'DELETE', path }, 'Deletion rejected')
  const failure = await fetch(gateway.origin + path, { method: 'DELETE' })
  assert.equal(failure.status, 503)
  assert.equal((await failure.json()).error, 'Deletion rejected')
  assert.ok(gateway.sessions.has('preview-week'))
  assert.equal((await fetch(gateway.origin + path, { method: 'DELETE' })).status, 200)
  assert.equal(gateway.sessions.has('preview-week'), false)
})

test('legacy fixture reports a missing mutation snapshot route before allowing a session write', async t => {
  const gateway = await fixture(t)
  const path = gateway.origin + '/api/sessions/preview-week'
  const snapshot = await fetch(path + '/mutation-snapshot')
  assert.equal(snapshot.status, 404)
  assert.deepEqual(await snapshot.json(), { error: 'No such API endpoint' })
  const update = await fetch(path, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pinned: true }) })
  assert.equal(update.status, 200)
  assert.equal(gateway.sessions.get('preview-week').pinned, true)
  gateway.controls.assertExpected()
})

test('approval RPC has authoritative state and errors retain the confirmed value', async t => {
  const gateway = await fixture(t)
  const params = { key: 'approvals.mode' }
  assert.equal((await gateway.request('config.get', params)).result.value, 'smart')
  assert.equal((await gateway.request('config.set', { ...params, value: 'manual' })).result.value, 'manual')
  gateway.controls.reject({ transport: 'rpc', method: 'config.set' }, 'Approval rejected')
  assert.equal((await gateway.request('config.set', { ...params, value: 'off' })).error.message, 'Approval rejected')
  assert.equal((await gateway.request('config.get', params)).result.value, 'manual')
})

test('config REST saves merge nested edits, preserve profiles, and distinguish saved values from defaults', async t => {
  const gateway = await fixture(t)
  const read = async (profile, suffix = '') => (await fetch(`${gateway.origin}/api/config?profile=${profile}${suffix}`)).json()
  const write = async (profile, config, bodyProfile) => fetch(`${gateway.origin}/api/config?profile=${profile}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config, profile: bodyProfile })
  })
  assert.deepEqual(await read('research', '&include_defaults=false'), {})
  const defaults = await (await fetch(gateway.origin + '/api/config/defaults')).json()
  assert.deepEqual(await read('research'), defaults)
  assert.equal((await write('research', { display: { show_reasoning: false, sections: { tools: false } }, custom: { tags: ['first'] } })).status, 200)
  assert.deepEqual(await (await write('research', { display: { sections: { messages: true } }, custom: { tags: [], note: null } })).json(), { ok: true })
  const config = await read('research')
  assert.deepEqual(config.display, { show_reasoning: false, sections: { tools: false, messages: true } })
  assert.deepEqual(config.custom, { tags: [], note: null })
  assert.deepEqual(config.model, defaults.model)
  assert.equal(config.config, undefined)
  assert.deepEqual(await read('writer'), defaults)
  // The pinned REST API gives an explicit body profile precedence over its query.
  await write('research', { display: { show_reasoning: false } }, 'writer')
  assert.equal((await read('writer')).display.show_reasoning, false)
  assert.deepEqual(await (await fetch(gateway.origin + '/api/config/defaults')).json(), defaults)
  gateway.controls.assertExpected()
})

test('config RPC and REST share profile state and normalize display toggles', async t => {
  const gateway = await fixture(t)
  const write = config => fetch(gateway.origin + '/api/config?profile=research', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config })
  })
  await write({ approvals: { mode: 'manual' } })
  assert.equal((await gateway.request('config.get', { key: 'approvals.mode' })).result.value, 'manual')
  assert.deepEqual((await gateway.request('config.set', { key: 'display.in_app_tips', value: 'false' })).result, { key: 'display.in_app_tips', value: false })
  const rest = await (await fetch(gateway.origin + '/api/config?profile=research')).json()
  assert.equal(rest.display.in_app_tips, false)
  assert.deepEqual((await gateway.request('config.get', { key: 'full' })).result, { config: rest })
  assert.equal((await gateway.request('config.set', { key: 'approval_mode', value: 'OFF', profile: 'writer' })).result.value, 'off')
  assert.equal((await gateway.request('config.get', { key: 'approvals.mode', profile: 'writer' })).result.value, 'off')
  assert.equal((await gateway.request('config.get', { key: 'approvals.mode' })).result.value, 'manual')
  gateway.controls.assertExpected()
})

test('rejected and invalid config saves retain the last confirmed record', async t => {
  const gateway = await fixture(t)
  const read = async () => (await fetch(gateway.origin + '/api/config?profile=research')).json()
  const write = config => fetch(gateway.origin + '/api/config?profile=research', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config })
  })
  await write({ display: { show_reasoning: false } })
  const confirmed = await read()
  gateway.controls.reject({ transport: 'http', method: 'PUT', path: '/api/config' }, 'Save rejected')
  assert.equal((await write({ display: { show_reasoning: true } })).status, 503)
  for (const invalid of [null, [], { approvals: { mode: 'unknown' }, display: { show_reasoning: true } }]) assert.equal((await write(invalid)).status, 422)
  assert.match((await gateway.request('config.set', { key: 'display.in_app_tips', value: 'invalid' })).error.message, /takes true or false/)
  assert.deepEqual(await read(), confirmed)
  assert.equal((await fetch(gateway.origin + '/api/config?profile=missing')).status, 404)
  gateway.controls.assertExpected()
  assert.equal((await gateway.request('config.get', { key: 'unimplemented' })).error.code, -32601)
  assert.equal((await fetch(gateway.origin + '/api/config', { method: 'DELETE' })).status, 501)
  assert.equal(gateway.controls.unexpected.length, 2)
})

test('group projection writes are validated and returned by roster reads', async t => {
  const gateway = await fixture(t)
  const snapshot = { version: 3, rooms: { 'id:team': { name: 'Team', roomId: 'team', members: [{ name: 'research' }], log: [] } }, deleted: {} }
  const write = ui_meta => gateway.request('profiles.configure', { name: 'default', ui_meta })
  assert.equal((await write({ 'hermes-bots-groups': snapshot })).result.applied.ui_meta, true)
  const invalid = await write({ 'hermes-bots-groups': { version: 3, rooms: [] } })
  assert.match(invalid.error.message, /Invalid group room projection/)
  const profile = (await gateway.request('profiles.list')).result.profiles.find(row => row.name === 'default')
  assert.deepEqual(profile.ui_meta['hermes-bots-groups'], snapshot)
  gateway.controls.assertExpected()
})

test('Bot group membership writes retain the selected profile and reject invalid groups', async t => {
  const gateway = await fixture(t)
  const metadata = { groups: ['Team'], group: 'Team' }
  const write = groups => gateway.request('profiles.configure', { name: 'research', ui_meta: { 'hermes-bots': groups } })
  assert.equal((await write(metadata)).result.applied.ui_meta, true)
  assert.match((await write({ groups: [false] })).error.message, /Invalid Bot group membership/)
  const profiles = (await gateway.request('profiles.list')).result.profiles
  assert.deepEqual(profiles.find(row => row.name === 'research').ui_meta['hermes-bots'], metadata)
  assert.equal(profiles.find(row => row.name === 'writer').ui_meta, undefined)
  gateway.controls.assertExpected()
})

test('optional group image generation fails explicitly without invoking a provider', async t => {
  const gateway = await fixture(t)
  assert.match((await gateway.request('image.generate', { prompt: 'Group avatar' })).error.message, /unavailable in the synthetic gateway/)
  gateway.controls.assertExpected()
})

test('strict mode reports unknown RPC and REST instead of inventing success', async t => {
  const gateway = await fixture(t)
  assert.equal((await gateway.request('unknown.list')).error.code, -32601)
  assert.equal((await fetch(gateway.origin + '/api/unknown')).status, 501)
  assert.equal(gateway.controls.unexpected.length, 2)
  assert.throws(() => gateway.controls.assertExpected(), /Unexpected gateway operations/)
})

test('disconnect closes active sockets without destroying stored conversations', async t => {
  const gateway = await fixture(t)
  const closed = once(gateway.socket, 'close')
  gateway.disconnect()
  await closed
  assert.equal(gateway.sessions.get('preview-week').title, 'Plan a calmer working week')
})

test('slash completion accepts a slash query and leaves malformed operations strict', async t => {
  const gateway = await fixture(t)
  assert.deepEqual((await gateway.request('complete.slash', { text: '/resume' })).result, { items: [], replace_from: 1 })
  gateway.controls.assertExpected()
  assert.equal((await gateway.request('complete.slash', { text: false })).error.code, -32601)
  assert.throws(() => gateway.controls.assertExpected(), /complete.slash/)
})

test('slash usage acknowledges typed commands without accepting malformed metrics', async t => {
  const gateway = await fixture(t)
  assert.deepEqual((await gateway.request('shared_metrics.slash_command', { command: 'resume', session_id: 'preview-week' })).result, { ok: true })
  gateway.controls.assertExpected()
  for (const params of [{ command: '/resume' }, { command: false }, { command: 'resume', session_id: 'missing' }]) {
    assert.equal((await gateway.request('shared_metrics.slash_command', params)).error.code, -32601)
  }
  assert.throws(() => gateway.controls.assertExpected(), /shared_metrics.slash_command/)
})

test('command center catalogs are explicit reads and archived sessions stay separate', async t => {
  const gateway = await fixture(t)
  assert.deepEqual((await gateway.request('plugins.manage', { action: 'list' })).result, { plugins: [] })
  assert.deepEqual((await gateway.request('groups.list', { limit: 100, offset: 0 })).result, { rooms: [], next_offset: null })
  assert.deepEqual((await gateway.request('gateway.ping')).result, { pong: true })
  assert.deepEqual(await (await fetch(gateway.origin + '/api/git/review/rev-parse?path=%2Fworkspace&ref=HEAD')).json(), { sha: null })
  const schema = await (await fetch(gateway.origin + '/api/config/schema')).json()
  assert.equal(schema.fields['display.show_reasoning'].type, 'boolean')
  assert.deepEqual(await (await fetch(gateway.origin + '/api/env')).json(), {})
  const auxiliary = await (await fetch(gateway.origin + '/api/model/auxiliary')).json()
  assert.deepEqual(auxiliary.tasks, [])
  assert.equal(auxiliary.main.provider, 'custom')
  assert.equal((await fetch(gateway.origin + '/api/model/moa')).status, 501)
  gateway.sessions.get('preview-idea').archived = true
  const sessions = async archived => (await (await fetch(gateway.origin + '/api/profiles/sessions?archived=' + archived)).json()).sessions.map(row => row.id)
  assert.deepEqual(await sessions('only'), ['preview-idea'])
  assert.deepEqual(await sessions('exclude'), ['preview-week'])
  assert.deepEqual(await sessions('include'), ['preview-week', 'preview-idea'])
  gateway.controls.assertExpected()
  assert.equal((await gateway.request('plugins.manage', { action: 'install', name: 'unrequested' })).error.code, -32601)
  assert.throws(() => gateway.controls.assertExpected(), /plugins.manage/)
})

test('Bot roster metadata writes validate pin, visibility, and section fields without mutating on failure', async t => {
  const gateway = await fixture(t)
  const metadata = { pinned: true, hidden: false, sectionId: 'section-test' }
  const write = value => gateway.request('profiles.configure', { name: 'research', ui_meta: { 'hermes-bots': value } })
  assert.equal((await write(metadata)).result.applied.ui_meta, true)
  for (const invalid of [{ pinned: 'yes' }, { hidden: 1 }, { sectionId: [] }, { unexpected: true }]) assert.match((await write(invalid)).error.message, /Invalid Bot metadata/)
  const profiles = (await gateway.request('profiles.list')).result.profiles
  assert.deepEqual(profiles.find(row => row.name === 'research').ui_meta['hermes-bots'], metadata)
  assert.equal(profiles.find(row => row.name === 'writer').ui_meta, undefined)
  gateway.controls.assertExpected()
})


test('warm reconnect and pending-work probes use the renderer contract without inventing work', async t => {
  const gateway = await fixture(t)
  const resumed = (await gateway.request('session.resume', { session_id: 'preview-week' })).result
  const activated = (await gateway.request('session.activate', { session_id: 'preview-week' })).result
  assert.equal(activated.session_id, resumed.session_id)
  assert.deepEqual(activated.messages, resumed.messages)
  assert.deepEqual((await gateway.request('subagent.roster')).result, { sessions: [] })
  assert.deepEqual((await gateway.request('approval.pending', { session_id: 'preview-week' })).result, { approvals: [] })
  gateway.controls.assertExpected()
  assert.equal((await gateway.request('approval.pending', { session_id: 'missing' })).error.code, -32601)
})
