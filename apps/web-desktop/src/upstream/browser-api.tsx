import type { ComponentProps, ComponentType } from 'react'
import { SessionActionsMenu as RendererSessionActionsMenu } from '@/app/chat/sidebar/session-actions-menu'

type BrowserPanelMenuProps = {
  keyboardShortcuts?: boolean
  browserPanelEntries?: readonly { id: string; title?: unknown; data?: unknown }[]
  onBrowserPanelOpen?: () => void
}

// All renderer imports for browser shell composition stay at this boundary.
export { ContribWiring, WiredPane } from '@/app/contrib/wiring'
export { Button, cn, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, SearchField } from '@hermes/plugin-sdk'
export { SidebarProvider } from '@/components/ui/sidebar'
export { Codicon } from '@/components/ui/codicon'
export { Tip } from '@/components/ui/tooltip'
export { ActionsMenu, ActionsContextMenu } from '@/components/ui/actions-menu'
export type { ActionItemSpec, MenuKit } from '@/components/ui/actions-menu'
export { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
export type { OverlayNavGroup } from '@/app/overlays/overlay-split-layout'
// The browser transform adds these browser-only props to the renderer menu.
export const SessionActionsMenu = RendererSessionActionsMenu as ComponentType<
  ComponentProps<typeof RendererSessionActionsMenu> & BrowserPanelMenuProps
>
export { ContribRender, ContribBoundary } from '@/contrib/react/boundary'
export { useContributions } from '@/contrib/react/use-contributions'
export { contributedRoutes, ROUTES_AREA, APP_ROUTES, navigateToWorkspacePage } from '@/app/routes'
export { botRosterMeta } from '@/plugins/hermes-bots/routing'
export { displayName } from '@/plugins/hermes-bots/labels'
export { avatarColor, botAppearance, BotFace } from '@/plugins/hermes-bots/avatar'
export { DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from '@/components/ui/dropdown-menu'
export { Brain, Power, ShieldLock } from '@/lib/icons'
export { useI18n } from '@/i18n'
export { notifyError } from '@/store/notifications'
export { botSourceStatus } from '@/plugins/hermes-bots/data'
export { GatewayKindGlyph, rosterGatewayOptions } from '@/plugins/hermes-bots/roster-sections'
export type { RosterActivityFilter, RosterKindFilter, RosterRow } from '@/plugins/hermes-bots/types'
export { comboFromEvent, formatCombo, IS_MAC } from '@/lib/keybinds/combo'
export { getBaseColors, useTheme } from '@/themes/context'
export type { useBots } from '@/plugins/hermes-bots/i18n'
export { findGroupOfPane } from '@/components/pane-shell/tree/model'
export { LayoutTreeRoot } from '@/components/pane-shell/tree/renderer'
export { SessionTileCloseConfirm } from '@/app/chat/session-tile'
export { OverlayView } from '@/app/overlays/overlay-view'
export type { TitlebarTool } from '@/app/shell/titlebar-controls'
export type { StatusbarItem } from '@/app/shell/statusbar-controls'

export { BrowserWorkspace } from './browser-workspace'

export { BrowserPageRoutes } from './browser-routes'

export { PanelRowMenu, type PanelMenuItem } from '@/app/overlays/panel'
export { profileLabel } from '@/store/profile'
export { renderActionItem } from '@/components/ui/actions-menu'
export type { ProfileInfo } from '@/hermes'
