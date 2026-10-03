import { getBaseColors, useTheme } from '@/themes/context'
import { Codicon } from '../../upstream/browser-api'

type Props = { onBack: () => void }

export function BrowserColorThemesPage({ onBack }: Props) {
  const { availableThemes, mode, resolvedMode, setMode, setTheme, themeName } = useTheme()

  return <section className="browser-color-themes" aria-label="Colour themes">
    <header className="browser-color-themes-heading">
      <button aria-label="Back to Appearance" className="browser-color-themes-back" onClick={onBack} type="button">
        <Codicon name="arrow-left" />
      </button>
      <div>
        <h2>Colour themes</h2>
        <p>Choose a theme for Athena.</p>
      </div>
    </header>
    <div className="browser-color-themes-mode" aria-label="Theme mode">
      {(['system', 'light', 'dark'] as const).map(value => <button
        aria-pressed={mode === value}
        className={mode === value ? 'is-active' : ''}
        key={value}
        onClick={() => setMode(value)}
        type="button"
      >{value === 'system' ? 'System' : value === 'light' ? 'Light' : 'Dark'}</button>)}
    </div>
    <div className="browser-color-themes-grid">
      {availableThemes.map(theme => {
        const colors = getBaseColors(theme.name, resolvedMode)
        const active = themeName === theme.name
        return <button
          aria-pressed={active}
          className={`browser-color-theme-card${active ? ' is-active' : ''}`}
          key={theme.name}
          onClick={() => setTheme(theme.name)}
          type="button"
        >
          <span className="browser-color-theme-preview" style={{ background: colors.background, borderColor: colors.border }}>
            <i style={{ background: colors.foreground }} />
            <i style={{ background: colors.accent }} />
            <i style={{ background: colors.secondary }} />
          </span>
          <span className="browser-color-theme-name">{theme.label}</span>
          <span className="browser-color-theme-description">{theme.description}</span>
        </button>
      })}
    </div>
  </section>
}
