import { test, expect } from '@playwright/test'
import { createBuiltApplication } from './built-application.mjs'

let application
test.beforeAll(async () => { application = await createBuiltApplication() })
test.afterAll(async () => { await application?.close() })

test('context ring shows occupancy beside chat actions and clears it on conversation switch', async ({ page }) => {
  let finishNext
  await page.routeWebSocket(/\/api\/ws/, socket => {
    const server = socket.connectToServer()
    server.onMessage(message => socket.send(message))
    socket.onMessage(message => {
      const frame = JSON.parse(String(message))
      if (frame.method === 'session.context_breakdown') {
        const respond = result => socket.send(JSON.stringify({ jsonrpc: '2.0', id: frame.id, result }))
        if (frame.params.session_id.includes('idea')) {
          finishNext = () => respond({ context_used: 10000, context_max: 200000, context_estimated: true, categories: [] })
        } else respond({ context_used: 444100, context_max: 1000000, categories: [] })
        return
      }
      server.send(message)
    })
  })
  await page.goto(`${application.origin}/#/preview-week`)
  const ring = page.locator('.browser-context-usage')
  await expect(ring).toHaveAccessibleName('Context 444.1K / 1M (44%)')
  const actions = page.getByRole('button', { name: 'Chat actions', exact: true })
  const ringBounds = await ring.boundingBox(), menuBounds = await actions.boundingBox()
  expect(ringBounds.x + ringBounds.width).toBeLessThanOrEqual(menuBounds.x)
  await ring.hover()
  await expect(page.getByRole('tooltip', { name: 'Context 444.1K / 1M (44%)', exact: true })).toBeVisible()
  await page.mouse.move(0, 0)
  await ring.focus()
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('tooltip', { name: 'Context 444.1K / 1M (44%)', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Explore a product idea', exact: true }).click()
  await expect(ring).not.toHaveAccessibleName('Context 444.1K / 1M (44%)')
  await expect.poll(() => Boolean(finishNext)).toBe(true)
  finishNext()
  await expect(ring).toHaveAccessibleName('Estimated context 10K / 200K (5%)')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(ring).toBeVisible()
  await expect(actions).toBeVisible()
})
