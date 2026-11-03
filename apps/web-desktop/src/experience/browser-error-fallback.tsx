import { useState } from 'react'
import { Button, ErrorState, useI18n } from '../upstream/browser-api'
import { buildInfo } from '../build-info'

interface BrowserErrorFallbackProps {
  error: Error
  reset: () => void
}

/** Recovery actions must work even after the application and modal hosts unmount. */
export function BrowserErrorFallback({ error, reset }: BrowserErrorFallbackProps) {
  const { t } = useI18n()
  const [details, setDetails] = useState(false)
  const diagnosticText = JSON.stringify({
    app: 'Athena',
    build: buildInfo,
    error: { message: error.message, stack: error.stack }
  }, null, 2)

  const downloadDiagnostics = () => {
    const url = URL.createObjectURL(new Blob([diagnosticText], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'athena-diagnostics.json'
    document.body.append(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
  }

  return <div className="fixed inset-0 z-(--z-crash) grid place-items-center overflow-auto bg-(--ui-chat-surface-background) p-6" data-glass-opaque="">
    <ErrorState className="w-full max-w-[28rem]" title={t.errors.boundaryTitle} description={<>
      <p className="text-center text-sm text-muted-foreground">{t.errors.boundaryDesc}</p>
      {details && <pre className="max-h-48 overflow-auto whitespace-pre-wrap wrap-break-word text-left font-mono text-xs">{diagnosticText}</pre>}
    </>}>
      <Button className="font-semibold" onClick={reset} size="lg">{t.common.retry}</Button>
      <Button onClick={() => { window.location.hash = '/'; reset() }} variant="text">Return to chat</Button>
      <Button onClick={() => window.location.reload()} variant="text">{t.errors.reloadWindow}</Button>
      <Button aria-expanded={details} onClick={() => setDetails(value => !value)} variant="text">{details ? 'Hide error details' : 'Show error details'}</Button>
      <Button onClick={downloadDiagnostics} variant="text">Download diagnostics</Button>
    </ErrorState>
  </div>
}
