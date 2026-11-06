import assert from 'node:assert/strict'
import { test } from 'node:test'
import { officialRendererBuildOptions, rendererBuildOptions } from './hermes-vite-config.mjs'

test('official chunk rules remain native regexes accepted by the browser bundler', () => {
  const options = officialRendererBuildOptions()
  const groups = options.build.rolldownOptions.output.advancedChunks.groups
  assert.ok(groups.some(group => group.test instanceof RegExp && group.test.test('/node_modules/react/index.js')))
  assert.equal(options.build.manifest, 'renderer-manifest.json')
})

test('a changed executable build contract requires review instead of running upstream plugin code', () => {
  assert.throws(() => rendererBuildOptions('defineConfig(() => ({ build: process.exit(), css: {}, optimizeDeps: {} }))'), /executable/)
  assert.throws(() => rendererBuildOptions('defineConfig(() => ({ build: {}, css: {} }))'), /Missing/)
})
