import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compareRendererDependencies, shikiOverrides } from './renderer-dependencies.mjs'

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

test('Shiki lock inheritance preserves the separate majors used by the renderer and Streamdown', () => {
  const snapshots = {
    '@shikijs/core@3.23.0': {},
    '@shikijs/core@4.5.0': {},
    '@shikijs/types@3.23.0': {},
    '@shikijs/types@4.5.0': {},
    '@shikijs/vscode-textmate@10.0.2': {},
    'shiki@3.23.0': {},
    'shiki@4.5.0': {},
    'unrelated@2.0.0': {}
  }
  assert.deepEqual(shikiOverrides(snapshots), {
    '@shikijs/core@3': '3.23.0',
    '@shikijs/core@4': '4.5.0',
    '@shikijs/types@3': '3.23.0',
    '@shikijs/types@4': '4.5.0',
    '@shikijs/vscode-textmate@10': '10.0.2',
    'shiki@3': '3.23.0',
    'shiki@4': '4.5.0'
  })
  assert.throws(() => shikiOverrides({ ...snapshots, '@shikijs/types@4.6.0': {} }), /Multiple official Shiki resolutions/)
})
