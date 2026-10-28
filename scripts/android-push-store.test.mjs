import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { createAndroidPushStore } from './android-push-store.mjs'

test('a failed durable write does not commit a different in-memory registration', t => {
  const parent = mkdtempSync(path.join(tmpdir(), 'athena-store-'))
  t.after(() => rmSync(parent, { recursive: true, force: true }))
  const directory = path.join(parent, 'push')
  const store = createAndroidPushStore(directory)
  writeFileSync(directory, 'not a directory')
  assert.throws(() => store.update(state => state.devices.set('uncommitted', {})))
  assert.equal(store.devices.size, 0)
  assert.equal(readFileSync(directory, 'utf8'), 'not a directory')
})

test('a corrupt or unknown store version fails visibly instead of silently discarding bindings', t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'athena-store-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const file = path.join(directory, 'android-push.json')
  writeFileSync(file, '{invalid')
  assert.throws(() => createAndroidPushStore(directory))
  writeFileSync(file, JSON.stringify({ version: 99, devices: [], events: [] }))
  assert.throws(() => createAndroidPushStore(directory), /Invalid Android push store/)
})
