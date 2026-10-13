import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compareRendererDependencies } from './renderer-dependencies.mjs'

test('renderer dependencies inherit upstream and reject independent version drift', () => {
  const policy = { packages: ['react', 'router'], overrides: {} }
  const upstream = { dependencies: { react: '1.0.0', router: '2.0.0' } }
  const browser = { dependencies: { react: '1.0.0', router: '3.0.0' } }
  assert.deepEqual(compareRendererDependencies(upstream, browser, policy).map(row => row.status), ['upstream', 'review-required'])
})

test('reviewed overrides expire when the renderer pin changes its dependency contract', () => {
  const policy = { packages: ['router'], overrides: { router: { upstream: '2.0.0', version: '3.0.0', reason: 'Verified browser routing.' } } }
  const browser = { dependencies: { router: '3.0.0' } }
  assert.equal(compareRendererDependencies({ dependencies: { router: '2.0.0' } }, browser, policy)[0].status, 'reviewed-override')
  assert.throws(() => compareRendererDependencies({ dependencies: { router: '2.1.0' } }, browser, policy), /Review/)
  policy.overrides.router.reason = ''
  assert.throws(() => compareRendererDependencies({ dependencies: { router: '2.0.0' } }, browser, policy), /Review/)
})
