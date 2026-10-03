import type { Plugin } from 'vite'

function hideBrowserSetting(source: string, marker: string): string {
  const markerPosition = source.indexOf(marker)
  const conditionStart = source.lastIndexOf('{show(', markerPosition)
  const conditionEnd = conditionStart < 0 ? -1 : source.indexOf('&&', conditionStart)
  if (markerPosition < 0 || conditionStart < 0 || conditionEnd < 0 || conditionEnd >= markerPosition) {
    throw new Error(`Browser appearance setting boundary changed: ${marker}`)
  }
  const guardEnd = conditionEnd + '&&'.length
  return source.slice(0, guardEnd) + ' !window.__HERMES_WEB_BRIDGE__ &&' + source.slice(guardEnd)
}

function transformAppearance(source: string): string {
  source = source.replace('<ChatFontSetting />', '{window.__HERMES_WEB_BRIDGE__ ? null : <ChatFontSetting />}')
  source = hideBrowserSetting(source, 'checked={composerPopoutGesturesEnabled}')
  source = hideBrowserSetting(source, '<ResumeLastSessionSetting')
  source = hideBrowserSetting(source, 'label={a.tipsTitle}')
  source = hideBrowserSetting(source, 'label={a.toursTitle}')
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
