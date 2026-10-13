import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

function clipboardFixture({ nativeWrite, copy = () => true } = {}) {
  const textareas = []
  const navigator = { clipboard: nativeWrite ? { writeText: nativeWrite } : undefined }
  const document = {
    createElement: () => ({
      value: '', style: {}, setAttribute() {}, select() {},
      remove() { textareas.splice(textareas.indexOf(this), 1) }
    }),
    body: { append: element => textareas.push(element) },
    execCommand: command => {
      assert.equal(command, 'copy')
      return copy(textareas.at(-1).value)
    }
  }
  const context = vm.createContext({
    exports: {}, navigator, document,
    require: () => ({ browserCapabilities: () => ({ clipboard: Boolean(navigator.clipboard) }) })
  })
  const source = readFileSync(new URL('../apps/web-desktop/src/platform/clipboard.ts', import.meta.url), 'utf8')
  vm.runInContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context)
  return { writeClipboard: context.exports.writeClipboard, navigator, textareas }
}

const code = 'printf "hello" \\\n  --flag "世界"\n\n'

test('clipboard bridge bypasses a renderer shim that routes writes back to the bridge', async () => {
  const writes = []
  const fixture = clipboardFixture({
    nativeWrite(text) {
      assert.equal(this, fixture.navigator.clipboard, 'native Clipboard methods need their receiver')
      writes.push(text)
    }
  })
  let shimCalls = 0
  fixture.navigator.clipboard.writeText = async text => {
    // Bound the old recursion so the regression produces a useful failure.
    if (++shimCalls > 2) throw new Error('Recursive clipboard write')
    await fixture.writeClipboard(text)
  }
  assert.equal(await fixture.writeClipboard(code), true)
  assert.equal(shimCalls, 0)
  assert.deepEqual(writes, [code])
})

for (const nativeAvailable of [true, false]) {
  test(`clipboard falls back when native API is ${nativeAvailable ? 'denied' : 'unavailable'}`, async () => {
    const writes = []
    const fixture = clipboardFixture({
      nativeWrite: nativeAvailable ? async () => { throw new Error('Permission denied') } : undefined,
      copy: text => { writes.push(text); return true }
    })
    assert.equal(await fixture.writeClipboard(code), true)
    assert.deepEqual(writes, [code])
    assert.equal(fixture.textareas.length, 0)
  })
}

for (const copy of [() => false, () => { throw new Error('Copy denied') }]) {
  test('clipboard failure rejects so copy controls can report failure, and cleans up', async () => {
    const fixture = clipboardFixture({ copy })
    await assert.rejects(fixture.writeClipboard(code), /copy/i)
    assert.equal(fixture.textareas.length, 0)
  })
}
