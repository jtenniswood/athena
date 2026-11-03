import type { ComponentProps, ReactNode } from 'react'
import { BrowserProfileHeader, BrowserTreeStack, type BrowserProfileHeaderModel } from './sidebar-tree'
import { browserClassNames as cn } from './ui/classnames'

export function BrowserProfileNesting({ children }: { children: ReactNode }) {
  return <div className="ml-3 border-l border-border/50 pl-1">{children}</div>
}

export function BrowserProfileGroup({ model, empty, emptyLabel, children, dialog, ...props }: ComponentProps<'div'> & {
  model: BrowserProfileHeaderModel; empty: boolean; emptyLabel: string; dialog: ReactNode
}) {
  return <BrowserTreeStack {...props} className={cn(model.reorder?.dragging && 'relative z-10')}>
    <BrowserProfileHeader model={model} />
    {model.open && <>{children}{empty && <div className="px-2 py-1 text-xs text-(--ui-text-tertiary)" data-gateway-group-empty>{emptyLabel}</div>}</>}
    {dialog}
  </BrowserTreeStack>
}
