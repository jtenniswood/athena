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
    <h2>Configuration</h2>
    <p>Back up, restore, or reset the selected profile’s settings.</p>
    <div className="browser-configuration-actions">{actions}</div>
  </section>
}
