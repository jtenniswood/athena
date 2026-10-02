import { type Codec, persistentAtom } from '../upstream/persistence'

type InterfaceMode = 'advanced' | 'simple'
type Tiered = { tier?: 'advanced' }
const DEFAULT_INTERFACE_MODE: InterfaceMode = 'advanced'
const shownInMode = (mode: InterfaceMode) => (tool: Tiered) => mode === 'advanced' || !tool.tier

// Keep this override independent of the upstream titlebar store: the pinned
// renderer predates it, while newer renderers use this module through our alias.
export type TitlebarAppActionsSide = 'left' | 'right'

export const TITLEBAR_APP_ACTIONS_DEFAULT: TitlebarAppActionsSide = 'right'

export const TITLEBAR_FIXED_TOOLS = {
  'flip-panes': { tier: 'advanced' },
  hud: { tier: 'advanced' },
  layout: {},
  'right-sidebar': { tier: 'advanced' },
  settings: {},
  sidebar: {}
} satisfies Record<string, Tiered>

const codec: Codec<TitlebarAppActionsSide> = {
  decode: raw => (raw === 'left' || raw === 'right' ? raw : TITLEBAR_APP_ACTIONS_DEFAULT),
  encode: value => value
}

export const $titlebarAppActionsSide = persistentAtom<TitlebarAppActionsSide>(
  'hermes.desktop.titlebarAppActions',
  TITLEBAR_APP_ACTIONS_DEFAULT,
  codec
)

export function setTitlebarAppActionsSide(side: TitlebarAppActionsSide) {
  $titlebarAppActionsSide.set(side)
}

/** The web wrapper hides HUD, leaving Settings and Layout as the two app tools. */
export function titlebarAppActionsClusterCounts(
  side: TitlebarAppActionsSide,
  leftExtras = 0,
  rightExtras = 0,
  mode: InterfaceMode = DEFAULT_INTERFACE_MODE
): { left: number; right: number } {
  const isShown = shownInMode(mode)
  const appActionIds: (keyof typeof TITLEBAR_FIXED_TOOLS)[] = ['settings', 'layout']
  const rightFixedIds: (keyof typeof TITLEBAR_FIXED_TOOLS)[] = ['flip-panes', 'right-sidebar']
  const sidebar = 1
  const appActions = appActionIds.filter(id => isShown(TITLEBAR_FIXED_TOOLS[id])).length
  const rightFixed = rightFixedIds.filter(id => isShown(TITLEBAR_FIXED_TOOLS[id])).length

  return side === 'left'
    ? { left: sidebar + appActions + leftExtras, right: rightFixed + rightExtras }
    : { left: sidebar + leftExtras, right: appActions + rightFixed + rightExtras }
}
