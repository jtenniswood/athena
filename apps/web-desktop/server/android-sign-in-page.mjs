import { randomBytes } from 'node:crypto'

/** A standalone welcome screen: sign-in must work before the app bundle loads. */
export function androidSignInPage(res, status, content, callback) {
  const nonce = randomBytes(18).toString('base64url')
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
    'Content-Security-Policy': `default-src 'none'; img-src 'self'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
    'Referrer-Policy': 'same-origin', 'X-Content-Type-Options': 'nosniff'
  })
  res.end(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="color-scheme" content="light dark">
  <title>Athena Android sign-in</title>
  <style nonce="${nonce}">
    :root {
      color-scheme: light dark;
      --background: #f7f7f7; --text: #202530; --muted: #626a78;
      --primary: #202530; --on-primary: #fff; --focus: #335ad1;
      background: var(--background); color: var(--text);
      font: 1rem/1.5 system-ui, sans-serif;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --background: #111111; --text: #e7e9ee; --muted: #a9afbb;
        --primary: #e7e9ee; --on-primary: #171a20; --focus: #9bb3ff;
      }
    }
    * { box-sizing: border-box; }
    body { margin: 0; }
    main {
      min-height: 100vh; min-height: 100dvh; display: flex;
      padding: max(1.5rem, env(safe-area-inset-top)) max(1.5rem, env(safe-area-inset-right)) max(1.5rem, env(safe-area-inset-bottom)) max(1.5rem, env(safe-area-inset-left));
    }
    section { width: min(100%, 24rem); margin: auto; display: grid; gap: 1.25rem; text-align: center; }
    img { display: block; margin-inline: auto; border-radius: 1rem; }
    h1 { margin: 0; font-size: 1.5rem; font-weight: 600; letter-spacing: -0.03em; }
    p { margin: 0; color: var(--muted); font-size: .875rem; }
    a, button {
      display: flex; align-items: center; justify-content: center; width: 100%; min-height: 44px;
      border: 1px solid transparent; border-radius: .65rem; padding: .65rem .9rem;
      background: var(--primary); color: var(--on-primary); font: inherit; font-weight: 600;
      text-decoration: none; cursor: pointer;
    }
    :is(a, button):focus-visible { outline: 2px solid var(--focus); outline-offset: 3px; }
  </style>
</head>
<body>
  <main>
    <section aria-labelledby="title">
      <img src="/athena.svg" width="64" height="64" alt="">
      <h1 id="title">${callback ? 'Return to Athena' : 'Athena Android'}</h1>
      ${content}
    </section>
  </main>
  ${callback ? `<script nonce="${nonce}">window.location.replace(${JSON.stringify(callback)})</script>` : ''}
</body>
</html>`)
}
