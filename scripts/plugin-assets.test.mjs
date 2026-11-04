import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { createAthenaServices } from '../apps/web-desktop/server/services.mjs'

async function fixture(t) {
  const home = await mkdtemp(path.join(tmpdir(), 'athena-plugin-assets-'))
  const services = createAthenaServices({ target: 'https://gateway.example.test', home,
    directory: path.join(home, 'preferences'), sender: { enabled: false },
    fetch: async () => { throw new Error('Plugin metadata must not contact the gateway') }
  })
  const server = createServer((req, res) => { void services.handle(req, res).then(handled => { if (!handled) { res.writeHead(404); res.end() } }) })
  services.attach(server)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => { services.close(); await new Promise(resolve => server.close(resolve)); await rm(home, { recursive: true, force: true }) })
  const origin = `http://127.0.0.1:${server.address().port}`
  return { home, call: (route, options) => fetch(origin + route, options) }
}

test('missing plugin roots are empty while missing nested directories stay unavailable', async t => {
  const { call, home } = await fixture(t)
  for (const root of ['plugins', 'desktop-plugins']) {
    const empty = await call(`/${root}/.listing`)
    assert.equal(empty.status, 200)
    assert.deepEqual(await empty.json(), [])
    const missing = await call(`/${root}/absent/.listing`)
    assert.equal(missing.status, 404)
    assert.ok(!(await missing.text()).includes(home))
  }
})

test('shared plugin metadata includes nested files, directories and operator symlinks', async t => {
  const { call, home } = await fixture(t)
  for (const root of ['plugins', 'desktop-plugins']) {
    const directory = path.join(home, root, 'review #?%')
    await mkdir(path.join(directory, 'assets'), { recursive: true })
    await writeFile(path.join(directory, 'plugin.js'), 'export default {}')
    await writeFile(path.join(directory, '.hermes-package.json'), '{}')
    const source = path.join(home, `${root}-linked-source`)
    await mkdir(source)
    await writeFile(path.join(source, 'plugin.js'), 'export default {}')
    await symlink(source, path.join(home, root, 'linked'))
    await symlink(source + '-missing', path.join(home, root, 'broken'))
    const roots = await (await call(`/${root}/.listing`)).json()
    assert.ok(roots.some(entry => entry.name === 'linked' && entry.type === 'directory'))
    assert.ok(!roots.some(entry => entry.name === 'broken'))
    const response = await call(`/${root}/review%20%23%3F%25/.listing`)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.match(response.headers.get('content-type'), /application\/json/)
    assert.deepEqual((await response.json()).sort((a, b) => a.name.localeCompare(b.name)), [
      { name: '.hermes-package.json', type: 'file' }, { name: 'assets', type: 'directory' }, { name: 'plugin.js', type: 'file' }
    ])
    assert.deepEqual(await (await call(`/${root}/linked/.listing/`)).json(), [{ name: 'plugin.js', type: 'file' }])
    const head = await call(`/${root}/review%20%23%3F%25/.listing`, { method: 'HEAD' })
    assert.equal(head.status, 200)
    assert.equal(await head.text(), '')
  }
})

test('plugin metadata rejects unsupported methods and paths outside the root contract', async t => {
  const { call, home } = await fixture(t)
  await mkdir(path.join(home, 'desktop-plugins'))
  await writeFile(path.join(home, 'private.txt'), 'not a plugin')
  const method = await call('/desktop-plugins/.listing', { method: 'POST' })
  assert.equal(method.status, 405)
  assert.equal(method.headers.get('allow'), 'GET, HEAD')
  for (const route of ['/pluginsSecret/.listing', '/desktop-plugins/x%2f..%2f../.listing',
    '/desktop-plugins/x%5c../.listing', '/desktop-plugins/%00/.listing', '/desktop-plugins/%GG/.listing',
    '/desktop-plugins/%2e%2e/.listing']) {
    const response = await call(route)
    assert.equal(response.status, 404, route)
    assert.ok(!(await response.text()).includes('private.txt'))
  }
})


test('plugin bytes, MIME, HEAD and byte ranges use the same mounted source as listings', async t => {
  const { call, home } = await fixture(t)
  const folder = path.join(home, 'desktop-plugins', 'review #?%')
  await mkdir(folder, { recursive: true })
  await writeFile(path.join(folder, 'plugin.js'), 'export default {}')
  const bytes = Buffer.from([0, 1, 2, 3, 255])
  await writeFile(path.join(folder, 'bytes.bin'), bytes)
  await writeFile(path.join(folder, 'empty.txt'), '')
  const source = await call('/desktop-plugins/review%20%23%3F%25/plugin.js')
  assert.equal(source.status, 200)
  assert.equal(await source.text(), 'export default {}')
  assert.equal(source.headers.get('content-type'), 'application/javascript')
  assert.equal(source.headers.get('cache-control'), 'no-store')
  const binary = await call('/desktop-plugins/review%20%23%3F%25/bytes.bin')
  assert.deepEqual(Buffer.from(await binary.arrayBuffer()), bytes)
  assert.equal(binary.headers.get('content-type'), 'application/octet-stream')
  const head = await call('/desktop-plugins/review%20%23%3F%25/bytes.bin', { method: 'HEAD' })
  assert.equal(head.headers.get('content-length'), '5')
  assert.equal(await head.text(), '')
  for (const [range, expected] of [['bytes=1-3', [1, 2, 3]], ['bytes=-2', [3, 255]], ['bytes=3-', [3, 255]]]) {
    const response = await call('/desktop-plugins/review%20%23%3F%25/bytes.bin', { headers: { Range: range } })
    assert.equal(response.status, 206)
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], expected)
    assert.match(response.headers.get('content-range'), /^bytes \d+-\d+\/5$/)
  }
  const absentRange = await call('/desktop-plugins/review%20%23%3F%25/bytes.bin', { headers: { Range: 'bytes=9-10' } })
  assert.equal(absentRange.status, 416)
  assert.equal(absentRange.headers.get('content-range'), 'bytes */5')
  const empty = await call('/desktop-plugins/review%20%23%3F%25/empty.txt')
  assert.equal(empty.status, 200)
  assert.equal(await empty.text(), '')
  for (const route of ['/desktop-plugins/review%20%23%3F%25', '/desktop-plugins/missing.js', '/desktop-plugins/x%2f..%2f../private.txt']) {
    assert.equal((await call(route)).status, 404)
  }
})
