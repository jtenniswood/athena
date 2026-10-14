import type { Alias } from 'vite'
export function rendererAliases(root?: string): Alias[]
export function compatibilityAliases(root: string, env?: Record<string, string | undefined>): Alias[]
export function compatibilitySingletons(root: string): string[]
