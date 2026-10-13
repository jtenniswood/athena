/** Shared welcome screen, usable before runtime configuration or chat loads. */
export function createSignInView(message: string): {
  section: HTMLElement
  card: HTMLElement
  status: HTMLParagraphElement
} {
  const section = document.createElement('main')
  section.className = 'athena-sign-in'
  section.innerHTML = `
    <section class="athena-sign-in-card" aria-labelledby="athena-sign-in-title">
      <img class="hermes-startup-logo" src="/athena.svg" width="64" height="64" alt="" />
      <h1 id="athena-sign-in-title">Welcome to Athena</h1>
      <p class="athena-sign-in-status" role="status" aria-live="polite"></p>
    </section>`
  const card = section.querySelector<HTMLElement>('.athena-sign-in-card')!
  const status = card.querySelector<HTMLParagraphElement>('[role="status"]')!
  status.textContent = message
  status.hidden = !message
  return { section, card, status }
}
