import { expect } from '@playwright/test'

async function finishMotion(locator) {
  await locator.evaluate(async element => {
    for (let node = element; node; node = node.parentElement) {
      await Promise.all(node.getAnimations().filter(animation =>
        animation.effect?.getComputedTiming().iterations !== Infinity
      ).map(animation => animation.finished.catch(() => {})))
    }
  })
}

export function narrowDesktopChecks(test, open) {
  test('narrow desktop preserves scale and mouse menus while hiding navigation', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await open(page)
    await page.evaluate(() => window.hermesDesktop.zoom.setPercent(150))
    const editor = page.locator('[contenteditable="true"]:visible').first()
    const navigation = page.locator('#browser-navigation')
    const main = page.locator('.browser-main')
    const sidebarWidth = (await navigation.boundingBox()).width
    const chatActions = page.getByRole('button', { name: 'Chat actions', exact: true })
    await editor.fill('Keep my desktop draft through resizing')
    await finishMotion(chatActions)
    const initialSize = await chatActions.boundingBox()
    await chatActions.click()
    const actionsMenu = page.getByRole('menu', { name: 'Chat actions', exact: true })
    await finishMotion(actionsMenu)
    const initialRow = await actionsMenu.getByRole('menuitem', { name: /^Rename/ }).boundingBox()
    await page.keyboard.press('Escape')

    for (const width of [767, 600, 390]) {
      await page.setViewportSize({ width, height: 900 })
      await expect(navigation).toBeHidden()
      await expect(editor).toHaveText('Keep my desktop draft through resizing')
      await finishMotion(chatActions)
      expect((await chatActions.boundingBox()).height).toBeCloseTo(initialSize.height, 1)
      expect(await page.evaluate(async () => (await window.hermesDesktop.zoom.get()).percent)).toBe(150)
      await chatActions.click()
      await expect(actionsMenu).toBeVisible()
      await finishMotion(actionsMenu)
      expect((await actionsMenu.getByRole('menuitem', { name: /^Rename/ }).boundingBox()).height).toBeCloseTo(initialRow.height, 1)
      expect((await actionsMenu.boundingBox()).width).toBeLessThan(width)
      await expect(page.locator('.browser-action-sheet')).toHaveCount(0)
      await page.keyboard.press('Escape')

      const chatBounds = await main.boundingBox()
      const toggle = page.getByRole('button', { name: /^(Open navigation|Back to home|Back to chat history)$/ })
      await toggle.click()
      await expect(navigation).toBeVisible()
      await finishMotion(navigation)
      await expect(main).toBeVisible()
      await expect(main).toHaveAttribute('inert', '')
      expect(await main.boundingBox()).toEqual(chatBounds)
      const drawerBounds = await navigation.boundingBox()
      expect(drawerBounds.width).toBeCloseTo(Math.min(sidebarWidth, width - 72), 0)
      expect(drawerBounds.x).toBe(0)
      if (width === 600) await page.screenshot({ path: testInfo.outputPath('desktop-sidebar-overlay.png') })
      // Clicking the exposed chat dismisses the drawer without editing the draft.
      await page.mouse.click(width - 12, 450)
      await expect(navigation).toBeHidden()
      await expect(main).not.toHaveAttribute('inert')
      await expect(toggle).toBeFocused()
      await expect(editor).toHaveText('Keep my desktop draft through resizing')
      await toggle.click()
      await page.getByRole('button', { name: 'Close navigation', exact: true }).click()
      await expect(navigation).toBeHidden()
      await expect(toggle).toBeFocused()
      await toggle.click()
      await page.getByRole('tablist', { name: 'Navigation', exact: true }).click({ button: 'right' })
      const settingsPage = page.locator('[data-browser-settings-frame]')
      await expect(settingsPage).toBeVisible()
      await settingsPage.getByRole('button', { name: 'Chat panel', exact: true }).click()
      await expect(settingsPage.getByRole('checkbox', { name: 'Sessions', exact: true })).toBeChecked()
      await page.getByRole('button', { name: 'Close settings', exact: true }).click()
      await expect(editor).toHaveText('Keep my desktop draft through resizing')
      await toggle.click()

      await page.getByRole('button', { name: 'Filters', exact: true }).click()
      const parent = page.locator('[data-slot="dropdown-menu-content"]').last()
      await parent.getByRole('menuitem', { name: 'Ordering', exact: true }).hover()
      await expect(page.locator('[data-slot="dropdown-menu-sub-content"]')).toBeVisible()
      await expect(parent).toBeVisible()
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')
      await expect(navigation).toBeHidden()
      await expect(editor).toHaveText('Keep my desktop draft through resizing')
    }

    await page.setViewportSize({ width: 1280, height: 900 })
    await expect(navigation).toBeVisible()
    await expect(page.locator('.browser-scrim')).toHaveCount(0)
    await expect(main).not.toHaveAttribute('inert')
    expect((await main.boundingBox()).x).toBeGreaterThanOrEqual(sidebarWidth - 1)
    await page.getByRole('button', { name: 'Hide navigation', exact: true }).click()
    await page.setViewportSize({ width: 600, height: 900 })
    await page.setViewportSize({ width: 1280, height: 900 })
    await expect(navigation).toBeHidden()
  })

  test('touch navigation still fills the viewport and hides the chat', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    const page = await context.newPage()
    try {
      await open(page)
      const editor = page.locator('[contenteditable="true"]:visible').first()
      await editor.fill('Keep the mobile draft')
      for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
        await page.setViewportSize(viewport)
        await page.getByRole('button', { name: /^(Open navigation|Back to home|Back to chat history)$/ }).tap()
        const navigation = page.getByRole('dialog', { name: 'Navigation', exact: true })
        await expect(navigation).toBeVisible()
        await expect(page.locator('.browser-main')).toBeHidden()
        expect((await navigation.boundingBox()).width).toBeCloseTo(viewport.width, 0)
        await expect(page.locator('.browser-scrim')).toHaveCount(0)
        await page.locator('.browser-sessions-pane button[data-slot="row-button"]').filter({ hasText: 'Plan a calmer working week' }).tap()
        await expect(navigation).toBeHidden()
        await expect(editor).toHaveText('Keep the mobile draft')
      }
    } finally {
      await context.close()
    }
  })

}
