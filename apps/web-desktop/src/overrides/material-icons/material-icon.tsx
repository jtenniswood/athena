import { forwardRef, type CSSProperties, type SVGProps } from 'react'
import { Codicon } from '@/components/ui/codicon'
import names from './names.json'
import outlines from './outlined-paths.json'

const paths: Readonly<Record<string, string>> = outlines
const codicons: Readonly<Record<string, string>> = names.codicon
const filledTools = new Set(names.filledTools)

export function materialPathForCodicon(name: string): string {
  return paths[codicons[name] ?? names.fallback]
}

type MaterialIconProps = Omit<SVGProps<SVGSVGElement>, 'name'> & {
  symbol: string
  size?: number | string
}

export const MaterialIcon = forwardRef<SVGSVGElement, MaterialIconProps>(function MaterialIcon({
  symbol, size = 24, color = 'currentColor', stroke: _stroke, ...props
}, ref) {
  return <svg ref={ref} aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill={color}
    data-material-symbol={symbol} {...props}>
    <path d={paths[symbol] ?? paths[names.fallback]} />
  </svg>
})

// Keep the SVG element, ref, and size API expected by the renderer's icon libraries.
export function createMaterialIcon(symbol: string) {
  const Icon = forwardRef<SVGSVGElement, Omit<MaterialIconProps, 'symbol'>>((props, ref) =>
    <MaterialIcon {...props} symbol={symbol} ref={ref} />)
  Icon.displayName = symbol
  return Icon
}

export interface ToolIconProps {
  className?: string
  name: string
  size?: number | string
}

export function MaterialToolIcon({ className, name, size = '0.875rem' }: ToolIconProps) {
  if (!filledTools.has(name)) return <Codicon className={className} name={name} size={size} />
  const dimensions: CSSProperties = { width: size, height: size }
  return <MaterialIcon className={['shrink-0', className].filter(Boolean).join(' ')}
    symbol={codicons[name] + ':filled'} style={dimensions} />
}
