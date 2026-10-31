import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'athena-startup-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const env = {
    HERMES_HOME: path.join(root, 'home'),
    HERMES_STATIC_ROOT: path.join(root, 'static'),
    HERMES_STATE_DIR: path.join(root, 'state'),
    HERMES_NGINX_CONFIG: path.join(root, 'nginx.conf'),
    HERMES_NGINX_TEMPLATE: fileURLToPath(new URL('../nginx.conf.template', import.meta.url)),
    HERMES_GATEWAY_URL: 'https://gateway.example.test',
    HERMES_AUTH_MODE: 'oidc'
  }
  mkdirSync(env.HERMES_HOME)
  mkdirSync(env.HERMES_STATIC_ROOT)
  writeFileSync(path.join(env.HERMES_STATIC_ROOT, 'build-info.json'), JSON.stringify({
    wrapperRevision: 'wrapper-test', rendererRevision: 'renderer-test',
    builtAt: '2026-01-01T00:00:00.000Z', channel: 'test'
  }))
  return env
}

function start(env) {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./runtime-config.mjs', import.meta.url))], {
    env, encoding: 'utf8'
  })
  assert.ifError(result.error)
  return result
}

const lines = output => output.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))

test('container startup logs build and configuration after writing usable runtime files', t => {
  const env = fixture(t)
  mkdirSync(path.join(env.HERMES_HOME, 'plugins'))
  writeFileSync(path.join(env.HERMES_HOME, 'plugins', 'private-plugin-name'), '')
  const result = start(env)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stderr, '')
  const logs = lines(result.stdout)
  assert.ok(logs.every(entry => entry.service === 'athena' && !Number.isNaN(Date.parse(entry.time))))
  assert.equal(logs.find(entry => entry.event === 'build_info').wrapperRevision, 'wrapper-test')
  assert.equal(logs.find(entry => entry.directory === 'plugins').entries, 1)
  const configured = logs.at(-1)
  assert.equal(configured.event, 'runtime_configured')
  assert.equal(configured.gateway, env.HERMES_GATEWAY_URL)
  assert.equal(configured.authMode, undefined)
  assert.ok(!result.stdout.includes('private-plugin-name'))
  assert.ok(readFileSync(env.HERMES_NGINX_CONFIG, 'utf8').includes('proxy_pass https://gateway.example.test;'))
  assert.ok(!readFileSync(path.join(env.HERMES_STATIC_ROOT, 'runtime-config.js'), 'utf8').includes('"auth"'))
})

test('unavailable plugin directories and build identity warn without stopping startup', t => {
  const env = fixture(t)
  writeFileSync(path.join(env.HERMES_HOME, 'plugins'), 'not a directory')
  rmSync(path.join(env.HERMES_STATIC_ROOT, 'build-info.json'))
  const result = start(env)
  assert.equal(result.status, 0, result.stderr)
  const warnings = lines(result.stderr)
  assert.equal(warnings.find(entry => entry.event === 'plugin_directory').available, false)
  assert.equal(warnings.find(entry => entry.event === 'build_info_unavailable').code, 'ENOENT')
  assert.ok(warnings.every(entry => entry.level === 'warn'))
  assert.equal(lines(result.stdout).at(-1).event, 'runtime_configured')
})

test('invalid gateway settings fail startup without logging credentials or query tokens', t => {
  const env = fixture(t)
  for (const url of ['https://user:private-password@gateway.example.test', 'https://gateway.example.test/?token=private-token']) {
    const result = start({ ...env, HERMES_GATEWAY_URL: url })
    assert.equal(result.status, 1)
    assert.equal(result.stdout, '')
    const error = lines(result.stderr)[0]
    assert.equal(error.event, 'startup_failed')
    assert.equal(error.stage, 'validate_environment')
    assert.ok(error.message.includes('HERMES_GATEWAY_URL'))
    assert.ok(!result.stderr.includes('private-'))
  }
})

test('runtime write failures log the failing stage and do not announce configuration success', t => {
  const env = fixture(t)
  const result = start({ ...env, HERMES_NGINX_CONFIG: env.HERMES_STATIC_ROOT })
  assert.equal(result.status, 1)
  assert.equal(result.stdout, '')
  const error = lines(result.stderr)[0]
  assert.equal(error.event, 'startup_failed')
  assert.equal(error.stage, 'write_runtime_configuration')
  assert.equal(error.code, 'EISDIR')
})
