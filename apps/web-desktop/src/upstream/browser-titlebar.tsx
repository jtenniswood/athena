import type { ComponentProps } from 'react'
import type { TitlebarControls as DesktopTitlebar } from '../../../desktop/src/app/shell/titlebar-controls'
export type { TitlebarTool } from '../../../desktop/src/app/shell/titlebar-controls'

/** The browser-focused shell owns its title-bar controls. */
export function TitlebarControls(_props: ComponentProps<typeof DesktopTitlebar>) {
  return null
}
