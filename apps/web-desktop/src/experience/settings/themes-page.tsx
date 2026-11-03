import { getBaseColors, useTheme } from '../../upstream/browser-api'
import { useSettingsPresentation } from './presentation'

export function BrowserColorThemesPage() {
  const { availableThemes, mode, resolvedMode, setMode, setTheme, themeName } = useTheme()
  const modes = (['system', 'light', 'dark'] as const).map(value => ({ value,
    label: value === 'system' ? 'System' : value === 'light' ? 'Light' : 'Dark',
    checked: mode === value, run: () => setMode(value) }))
  const themes = availableThemes.map(theme => ({ ...theme, checked: themeName === theme.name, run: () => setTheme(theme.name) }))
  const presentation = useSettingsPresentation([
    { kind: 'text', label: 'Choose a theme for Athena.' },
    { kind: 'heading', label: 'Theme mode' },
    ...modes.map(item => ({ id: `mode:${item.value}`, kind: 'action' as const, presentation: 'choice' as const,
      group: 'mode', label: item.label, checked: item.checked, run: item.run })),
    ...themes.map(item => ({ id: `theme:${item.name}`, kind: 'action' as const, presentation: 'choice' as const,
      group: 'theme', label: item.label, description: item.description, checked: item.checked, run: item.run }))
  ])

  return <section ref={presentation} className="browser-settings-page browser-color-themes" aria-label="Colour themes">
    <header className="browser-settings-page-header browser-color-themes-heading">
      <div>
        <h2 className="browser-settings-page-title">Colour themes</h2>
        <p className="browser-settings-page-description">Choose a theme for Athena.</p>
      </div>
    </header>
    <div className="browser-color-themes-mode" aria-label="Theme mode">
      {modes.map(item => <button
        aria-pressed={item.checked}
        className={item.checked ? 'is-active' : ''}
        key={item.value}
        onClick={item.run}
        type="button"
      >{item.label}</button>)}
    </div>
    <div className="browser-color-themes-grid">
      {themes.map(theme => {
        const colors = getBaseColors(theme.name, resolvedMode)
        const active = theme.checked
        return <button
          aria-pressed={active}
          className={`browser-color-theme-card${active ? ' is-active' : ''}`}
          key={theme.name}
          onClick={theme.run}
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
