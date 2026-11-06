import type { UserConfig } from 'vite'
export function officialRendererBuildOptions(): Pick<UserConfig, 'build' | 'css' | 'optimizeDeps'>
export function rendererBuildOptions(source: string): Pick<UserConfig, 'build' | 'css' | 'optimizeDeps'>
