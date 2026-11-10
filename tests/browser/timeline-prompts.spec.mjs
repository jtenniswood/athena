import { test, expect } from '@playwright/test'
import { createBuiltApplication } from './built-application.mjs'

test('the conversation timeline keeps only user prompts from loaded and indexed history', async ({ page }) => {
  const application = await createBuiltApplication()
  try {
    const rows = application.gateway.messages.get('preview-week')
    const timestamp = rows.at(-1).timestamp
    const generated = "You've reached the maximum number of tool-calling iterations allowed. Please provide a final response summarizing what you've found and accomplished so far, without calling any more tools."
    rows.push(
      { id: 20, role: 'user', content: generated, timestamp: timestamp + 1 },
      { id: 21, role: 'assistant', content: 'Here is what I finished.', timestamp: timestamp + 2 },
      { id: 22, role: 'user', content: 'Help me summarize what changed.', timestamp: timestamp + 3 }
    )
    await page.route('**/api/sessions/preview-week/timeline?**', route => route.fulfill({ json: {
      entries: [
        { row_id: 10, preview: 'An earlier user question.' },
        { row_id: 11, preview: generated.slice(0, 119).trimEnd() + '…' }
      ],
      pagination: { has_more: false, next_cursor: null }
    } }))
    await page.goto(application.origin + '/#/preview-week')
    const ticks = page.getByRole('navigation', { name: 'Conversation timeline' }).getByRole('button')
    await expect(ticks).toHaveCount(3)
    expect(await ticks.evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')))).toEqual([
      'An earlier user question.',
      'Help me make a thoughtful plan.',
      'Help me summarize what changed.'
    ])
    await expect(page.getByText('Here is what I finished.', { exact: true })).toBeVisible()
  } finally {
    await application.close()
  }
})
