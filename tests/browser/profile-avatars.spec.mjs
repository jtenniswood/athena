import { test, expect } from '@playwright/test'
import { createBuiltApplication } from './built-application.mjs'

test.use({ serviceWorkers: 'block', viewport: { width: 1440, height: 960 } })

const savedImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP44BECAAO4AY3wUnHtAAAAAElFTkSuQmCC'
const newImage = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNQSb0PAAIZAWnh2HEpAAAAAElFTkSuQmCC'

test('combined profiles restore and edit saved avatars without switching conversations', async ({ page }) => {
  const app = await createBuiltApplication()
  try {
    const profile = app.gateway.profiles.find(profile => profile.name === 'research')
    profile.has_avatar = true
    let avatar = savedImage
    const writes = []

    await page.addInitScript(image => {
      localStorage.setItem('hermes-web.browser.combined-profiles', 'true')
      localStorage.setItem('hermes.plugin.hermes-bots.bot-meta', JSON.stringify({ writer: { image } }))
    }, savedImage)
    await page.route('**/api/athena/preferences', route => route.abort())
    await page.routeWebSocket(/\/api\/ws/, socket => {
      const server = socket.connectToServer()
      socket.onMessage(data => {
        const frame = JSON.parse(String(data))
        if (frame.params?.name !== 'research') return server.send(data)
        let result
        if (frame.method === 'profiles.get_asset') {
          result = { found: Boolean(avatar), data: avatar }
        } else if (frame.method === 'profiles.set_asset') {
          avatar = frame.params.clear ? null : frame.params.data
          profile.has_avatar = Boolean(avatar)
          writes.push(frame.params)
          result = { ok: true }
        } else if (frame.method === 'profiles.configure') {
          profile.ui_meta = frame.params.ui_meta
          result = { applied: { ui_meta: true } }
        } else {
          return server.send(data)
        }
        socket.send(JSON.stringify({ jsonrpc: '2.0', id: frame.id, result }))
      })
    })

    await page.goto(app.origin + '/#/preview-week')
    const picture = page.locator('[data-browser-profile-picture="research"] img')
    const legacyPicture = page.locator('[data-browser-profile-picture="writer"] img')
    const research = page.locator('[data-gateway-group]').filter({ has: page.locator('[data-browser-profile-picture="research"]') })
    await expect(picture).toHaveAttribute('src', savedImage)
    await expect(legacyPicture).toHaveAttribute('src', savedImage)
    const composer = page.locator('[data-slot="composer-rich-input"]:visible').first()
    await composer.fill('Keep this draft while editing another profile')

    const dialog = page.getByRole('dialog', { name: 'Edit profile', exact: true })
    const editProfile = async () => {
      await research.getByRole('button', { name: 'Group actions: Research' }).click()
      await page.getByRole('menuitem', { name: 'Edit profile', exact: true }).click()
      await expect(dialog).toBeVisible()
    }
    await editProfile()
    await expect(dialog.locator('img')).toHaveAttribute('src', savedImage)
    await dialog.getByText('Upload', { exact: true }).click()
    const chooser = page.waitForEvent('filechooser')
    await dialog.getByRole('button', { name: 'Choose an image…' }).click()
    await (await chooser).setFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: Buffer.from(newImage, 'base64') })
    await expect(dialog.locator('img')).not.toHaveAttribute('src', savedImage)
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect.poll(() => writes.length).toBe(1)
    expect(writes[0]).toMatchObject({ name: 'research', asset: 'avatar', data: avatar })
    await expect(picture).toHaveAttribute('src', avatar)
    await expect(composer).toHaveText('Keep this draft while editing another profile')
    expect(new URL(page.url()).hash).toBe('#/preview-week')

    await page.reload()
    await expect(picture).toHaveAttribute('src', avatar)
    await editProfile()
    await dialog.getByRole('button', { name: 'Remove image — use shape' }).click()
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect.poll(() => writes.length).toBe(2)
    expect(writes[1]).toMatchObject({ name: 'research', asset: 'avatar', clear: true })
    await expect(picture).toHaveCount(0)
    await expect(legacyPicture).toHaveAttribute('src', savedImage)
    await page.reload()
    await expect(legacyPicture).toHaveAttribute('src', savedImage)
    await expect(picture).toHaveCount(0)
  } finally {
    await app.close()
  }
})

test.describe('phone history', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

  test('opens the profile avatar editor from the group menu', async ({ page }) => {
    const app = await createBuiltApplication()
    try {
      await page.route('**/api/athena/preferences', route => route.abort())
      await page.addInitScript(() => localStorage.setItem('hermes-web.browser.combined-profiles', 'true'))
      await page.goto(app.origin + '/#/preview-week')
      const history = page.locator('#browser-navigation')
      await history.getByRole('button', { name: 'Group actions: Research' }).tap()
      await page.getByRole('menuitem', { name: 'Edit profile', exact: true }).tap()
      const dialog = page.getByRole('dialog', { name: 'Edit profile', exact: true })
      await expect(dialog).toBeVisible()
      await dialog.getByText('Upload', { exact: true }).tap()
      await expect(dialog.getByRole('button', { name: 'Choose an image…' })).toBeVisible()
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).tap()
      await expect(dialog).toBeHidden()
      await expect(history.getByRole('button', { name: 'Group actions: Research' })).toBeVisible()
    } finally {
      await app.close()
    }
  })
})
