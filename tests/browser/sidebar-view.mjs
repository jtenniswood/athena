export async function showSidebarView(page, view, interaction = 'click') {
  const bots = page.getByRole('button', { name: 'Bots', exact: true })
  await bots.waitFor({ state: 'visible' })
  const pressed = await bots.getAttribute('aria-pressed')
  if ((pressed === 'true') !== (view === 'bots')) await bots[interaction]()
}
