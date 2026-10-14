import { registerAppLocale, type Translations } from '@/i18n'

// Layer browser copy over the bundled English catalog without changing other locales.
const copy = {
  language: {
    description: 'Choose the interface language.'
  } satisfies Partial<Translations['language']>,
  interfaceMode: {
    hint: 'Choose how much of the interface to show.',
    sessionNote: 'Simple mode: changes last for this session. Use Advanced to save them.',
    simple: { label: 'Simple', description: 'Chat and sidebar with fewer controls.' },
    advanced: { label: 'Advanced', description: 'More controls for files, tools, and layout.' }
  } satisfies Partial<Translations['interfaceMode']>,
  settings: {
    appearance: {
      uiScaleDesc: (_percent: number) => 'Resize all text and controls. Shortcuts: Cmd/Ctrl + plus, minus, or 0.',
      chatTextScaleDesc: 'Resize messages and the editor only, on top of UI Scale.',
      modelPricingDesc: 'Show input, output, and cache-read prices per million tokens.',
      fileBrowserDesc: 'Show workspace files beside the chat.',
      hideCodeDiffsDesc: 'Show added and removed line counts instead of code.',
      reasoningCollapsedDesc: 'Keep thinking collapsed until you open it.',
      toolViewDesc: 'Product shows summaries; Technical shows full tool inputs and results.',
      sessionDensityDesc: 'Choose how much detail appears under chat titles.',
      textDirectionDesc: 'Auto follows each paragraph’s first letter. Code stays left-to-right.',
      hideThreadTimelineDesc: 'Hide the navigation bars beside conversations.',
      reactionsDesc: 'Let you and Hermes react to messages with emoji.',
      vibeHeartsDesc: 'Show floating hearts for thanks, affection, or heart emoji.',
      embedsDesc: 'Load previews from external sites. Ask requires permission; Always loads automatically; Off shows links.',
      colorModeDesc: 'Use light, dark, or your system’s appearance.'
    } satisfies Partial<Translations['settings']['appearance']>,
    notifications: {
      intro: 'Choose which browser alerts to receive.',
      enableAllDesc: 'Turn off to silence all alerts below.',
      focusedHint: 'Response alerts appear when Athena is in the background.',
      completionSoundDesc: 'Play a sound when a reply finishes.'
    } satisfies Partial<Translations['settings']['notifications']>,
    pluginPages: {
      blurb: 'Settings for installed plugins.'
    } satisfies Partial<Translations['settings']['pluginPages']>
  }
}

const unregister = registerAppLocale('en', { translations: copy })
if (import.meta.hot) import.meta.hot.dispose(unregister)
