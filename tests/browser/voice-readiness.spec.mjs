import { test, expect } from '@playwright/test'
import { createBuiltApplication } from './built-application.mjs'

test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } })
let application, origin
test.beforeAll(async () => { application = await createBuiltApplication(); origin = application.origin })
test.afterAll(async () => { await application?.close() })
const composer = page => page.locator('[data-slot="composer-rich-input"]:visible').first()
async function updateMessage(page, type, transaction) {
  return page.context().serviceWorkers()[0].evaluate(async ({ type, transaction }) => {
    const [client] = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    if (type === 'HERMES_ABORT_UPDATE') { client.postMessage({ type, transaction }); return }
    return new Promise((resolve, reject) => {
      const channel = new MessageChannel()
      const timer = setTimeout(() => { channel.port1.close(); reject(new Error('Update admission did not reply')) }, 4000)
      channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); resolve(event.data) }
      client.postMessage({ type, transaction }, [channel.port2])
    })
  }, { type, transaction })
}

async function startLiveDictation(page) {
  let socket, ending = false
  await page.route(/\/api\/audio\/voice-config(?:\?|$)/, route => route.fulfill({ json: {
    ok: true, stt: { mode: 'relay', streaming: true }, tts: { mode: 'relay' }
  } }))
  await page.route(/\/api\/audio\/stt-lease(?:\?|$)/, route => route.fulfill({ json: { ok: true } }))
  await page.routeWebSocket(/\/api\/audio\/transcribe-stream/, connected => {
    socket = connected
    socket.onMessage(message => { if (typeof message === 'string' && JSON.parse(message).eos) ending = true })
  })
  await page.addInitScript(() => {
    window.voiceStreams = []
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    navigator.mediaDevices.getUserMedia = async constraints => {
      const stream = await getUserMedia(constraints)
      window.voiceStreams.push(stream)
      return stream
    }
  })
  await page.goto(`${origin}/#/preview-week`)
  await expect(composer(page)).toBeVisible({ timeout: 30000 })
  await composer(page).fill('Keep this draft')
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
  await page.getByRole('button', { name: 'Voice dictation', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Stop dictation', exact: true })).toBeVisible()
  await expect.poll(() => Boolean(socket)).toBe(true)
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: 'Stop dictation', exact: true }).click()
  await expect.poll(() => ending).toBe(true)
  await expect.poll(() => page.evaluate(() => window.voiceStreams.length > 0 && window.voiceStreams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')))).toBe(true)
  await expect(page.getByRole('button', { name: 'Transcribing dictation', exact: true })).toBeVisible()
  return socket
}

test('an update waits for the dictation transcript after its microphone closes', async ({ page }) => {
  const socket = await startLiveDictation(page)
  expect((await updateMessage(page, 'HERMES_FLUSH_UPDATE', 'voice-pending')).ready).toBe(false)
  await expect(page.locator('#root')).toHaveJSProperty('inert', false)
  const refused = await page.evaluate(async () => {
    try { await window.hermesDesktop.applyConnectionConfig({ remoteUrl: 'https://unconfigured.example.test' }); return null }
    catch (error) { return error.message }
  })
  expect(refused).toMatch(/recording or transcribing/)
  socket.send(JSON.stringify({ type: 'final', transcript: 'and my recorded words' }))
  await expect(composer(page)).toContainText('and my recorded words')
  await expect(composer(page)).toContainText('Keep this draft')
  expect((await updateMessage(page, 'HERMES_FLUSH_UPDATE', 'voice-complete')).ready).toBe(true)
  await updateMessage(page, 'HERMES_ABORT_UPDATE', 'voice-complete')
  await expect(page.locator('#root')).toHaveJSProperty('inert', false)
})

test('a failed dictation releases update safety without changing the draft', async ({ page }) => {
  await page.route(/\/api\/audio\/transcribe(?:\?|$)/, route => route.fulfill({ status: 503, body: 'Transcription unavailable' }))
  const socket = await startLiveDictation(page)
  expect((await updateMessage(page, 'HERMES_FLUSH_UPDATE', 'voice-failing')).ready).toBe(false)
  socket.send(JSON.stringify({ type: 'error', message: 'Live transcription unavailable' }))
  await expect(page.getByRole('button', { name: 'Voice dictation', exact: true })).toBeEnabled()
  await expect(composer(page)).toHaveText('Keep this draft')
  expect((await updateMessage(page, 'HERMES_FLUSH_UPDATE', 'voice-failed')).ready).toBe(true)
  await updateMessage(page, 'HERMES_ABORT_UPDATE', 'voice-failed')
  await expect(page.locator('#root')).toHaveJSProperty('inert', false)
})
