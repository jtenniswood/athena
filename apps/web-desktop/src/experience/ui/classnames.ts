import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Browser-owned components share the renderer's class-merging semantics. */
export function browserClassNames(...values: ClassValue[]) { return twMerge(clsx(values)) }
