import type { Plugin } from 'vite'

function jsxElementEnd(source: string, start: number): number {
  let braces = 0
  let quote = ''
  for (let index = start; index < source.length; index += 1) {
    const char = source[index]
    if (quote) {
      if (char === '\\') index += 1
      else if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue }
    if (char === '{') braces += 1
    else if (char === '}') braces -= 1
    else if (char === '>' && braces === 0) return index + 1
  }
  throw new Error('Browser appearance setting JSX boundary changed')
}

function hideElement(source: string, tag: string, marker: string): string {
  const markerPosition = source.indexOf(marker)
  const start = tag === 'ResumeLastSessionSetting' ? markerPosition : source.lastIndexOf(`<${tag}`, markerPosition)
  if (markerPosition < 0 || start < 0) throw new Error(`Browser appearance setting boundary changed: ${tag}`)
  const end = jsxElementEnd(source, start)
  return source.slice(0, start) + `{!window.__HERMES_WEB_BRIDGE__ && (${source.slice(start, end)})}` + source.slice(end)
}

function transformAppearance(source: string): string {
  source = source.replace('<ChatFontSetting />', '{window.__HERMES_WEB_BRIDGE__ ? null : <ChatFontSetting />}')
  source = hideElement(source, 'ToggleRow', 'checked={composerPopoutGesturesEnabled}')
  source = hideElement(source, 'ResumeLastSessionSetting', '<ResumeLastSessionSetting')
  source = hideElement(source, 'ToggleRow', 'label={a.tipsTitle}')
  source = hideElement(source, 'ToggleRow', 'label={a.toursTitle}')
  return source
}

export function browserSettingsChoicesPlugin(): Plugin {
  return {
    name: 'athena:browser-settings-choices',
    enforce: 'pre',
    transform(source, id) {
      if (!id.replaceAll('\\', '/').split('?')[0].endsWith('/desktop/src/app/settings/appearance-settings.tsx')) return null
      return { code: transformAppearance(source), map: null }
    }
  }
}
