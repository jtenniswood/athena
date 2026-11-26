import { expect } from '@playwright/test'
import { test, editor, openConversation } from './gateway-fixture.mjs'

test('a saved tool-heavy response keeps its final reply visible with activity collapsed', async ({ page, gatewayApp }) => {
  const session = 'preview-week'
  const timestamp = Math.floor(Date.now() / 1000) - 30
  const rows = gatewayApp.messages.get(session)
  rows.splice(1, 1,
    { id: 2, role: 'assistant', content: 'I checked the first detail.', timestamp, tool_calls: [
      { id: 'activity-command', type: 'function', function: { name: 'terminal', arguments: JSON.stringify({ command: 'pwd' }) } }
    ] },
    { id: 3, role: 'tool', tool_name: 'terminal', tool_call_id: 'activity-command', content: '{"output":"/workspace","exit_code":0}', timestamp: timestamp + 1 },
    { id: 4, role: 'assistant', content: 'Here is the finished answer.', timestamp: timestamp + 2 }
  )
  gatewayApp.sessions.get(session).message_count = rows.length
  await openConversation(page, gatewayApp.origin, session)

  const summary = page.getByRole('button', { name: 'Response activity' })
  const commentary = page.getByText('I checked the first detail.', { exact: true })
  const finalReply = page.getByText('Here is the finished answer.', { exact: true })
  const toolGroup = page.locator('[data-tool-group]')
  await expect(summary).toHaveAttribute('aria-expanded', 'false')
  await expect(commentary).toBeHidden()
  await expect(toolGroup).toBeHidden()
  await expect(finalReply).toBeVisible()

  await summary.click()
  await expect(summary).toHaveAttribute('aria-expanded', 'true')
  await expect(commentary).toBeVisible()
  await expect(toolGroup).toBeVisible()
  await expect(finalReply).toBeVisible()

  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Tab')
  await expect(summary).toBeFocused()
  await page.keyboard.press('Space')
  await expect(commentary).toBeHidden()
  await expect(finalReply).toBeVisible()
})

test('live activity stays on one line and leaves approval and the final reply visible', async ({ page, gatewayApp }) => {
  let emit, approval
  await page.routeWebSocket(/\/api\/ws/, socket => {
    const server = socket.connectToServer()
    socket.onMessage(message => {
      const { id, method, params } = JSON.parse(String(message))
      if (id === 'activity-approval' && !method) return
      if (method !== 'prompt.submit') {
        server.send(message)
        return
      }

      const { session_id, submission_id, profile } = params
      emit = (type, payload) => socket.send(JSON.stringify({
        jsonrpc: '2.0', method: 'event', params: { type, session_id, payload, timestamp: Date.now() }
      }))
      socket.send(JSON.stringify({ jsonrpc: '2.0', id, result: {
        status: 'started', session_id, submission_id, admission_id: submission_id, ref: { session_id, profile }
      } }))
      emit('message.start', { role: 'assistant' })
      emit('message.interim', { text: 'I am checking the details.' })
      emit('tool.start', { name: 'terminal', tool_call_id: 'live-command', args: { command: 'pwd' } })
    })
    approval = () => socket.send(JSON.stringify({
      jsonrpc: '2.0', id: 'activity-approval', method: 'approval', params: {
        session_id: 'preview-week', request_id: 'activity-approval', command: 'pwd', choices: ['once', 'deny']
      }
    }))
  })
  await openConversation(page, gatewayApp.origin)
  await editor(page).fill('Check something for me')
  await editor(page).press('Enter')

  const progress = page.locator('.browser-response-activity')
  await expect(progress).toHaveCount(1)
  await expect(progress).toHaveAccessibleName(/^Working/)
  await expect(progress).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByText('I am checking the details.', { exact: true })).toBeHidden()

  const spinner = progress.locator('.browser-response-activity-spinner')
  const spinStart = () => spinner.evaluate(async element => {
    const [animation] = element.getAnimations()
    await animation.ready
    return animation.startTime
  })
  const initialSpinStart = await spinStart()

  approval()
  await expect(progress).toHaveAccessibleName('Waiting for your input')
  await expect(spinner).toHaveCount(0)
  const card = page.locator('[data-slot="tool-approval-card"][data-request-id="activity-approval"]')
  await expect(card.getByRole('button', { name: 'Reject' })).toBeVisible()
  await card.getByRole('button', { name: 'Reject' }).click()

  emit('tool.complete', { name: 'terminal', tool_call_id: 'live-command', result: { output: '/workspace', exit_code: 0 } })
  emit('tool.start', { name: 'terminal', tool_call_id: 'next-command', args: { command: 'date' } })
  await expect(progress).toHaveAccessibleName(/^Working/)
  expect(await spinStart()).toBe(initialSpinStart)

  emit('tool.complete', { name: 'terminal', tool_call_id: 'next-command', result: { output: 'Thursday', exit_code: 0 } })
  emit('message.complete', { status: 'complete', text: 'The check is finished.' })

  await expect(progress).toHaveAccessibleName(/^Response activity \d/)
  await expect(progress).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByText('The check is finished.', { exact: true })).toBeVisible()
  await progress.click()
  await expect(page.getByText('I am checking the details.', { exact: true })).toBeVisible()
})
