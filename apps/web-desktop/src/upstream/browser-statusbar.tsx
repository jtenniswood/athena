import type { ComponentProps } from 'react'
import type { StatusbarControls as DesktopStatusbar } from '../../../desktop/src/app/shell/statusbar-controls'
export type { StatusbarItem, StatusbarMenuItem, SetStatusbarItemGroup } from '../../../desktop/src/app/shell/statusbar-controls'

/** Browser controls live in the navigation, composer, and Settings pages. */
export function StatusbarControls(_props: ComponentProps<typeof DesktopStatusbar>) {
  return null
}
