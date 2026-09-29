import { settingsPageLabel } from './policy'
import { useId, type ComponentPropsWithRef, type ReactNode } from 'react'

/** Keep upstream action handlers and confirmation flows on labelled controls. */
export function BrowserConfigurationAction({ description, children, className = '', ...props }: ComponentPropsWithRef<'button'> & { description: string }) {
  const descriptionId = useId()
  return <button {...props} type="button" className={`browser-configuration-action ${className}`} aria-describedby={descriptionId}>
    {children}
    <span>
      <span className="browser-configuration-action-label">{props['aria-label']}</span>
      <span className="browser-configuration-action-description" id={descriptionId}>{description}</span>
    </span>
  </button>
}

export function BrowserConfigurationPage({ actions }: { actions: ReactNode }) {
  return <section className="browser-configuration-page" aria-label="Configuration management">
    <h2>{settingsPageLabel('config:browser-configuration', 'Configuration')}</h2>
    <p>Manage the current profile configuration: export, restore, or reset. These actions do not include conversations, credentials, or server files.</p>
    <div className="browser-configuration-actions">{actions}</div>
  </section>
}
