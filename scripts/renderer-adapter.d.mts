import type { Alias, Plugin } from 'vite'
export function adapterAliases(root: string, env?: NodeJS.ProcessEnv): Alias[]
export function createRendererAdapter(root?: string): {
  root: string
  registry: ReadonlyArray<{ kind: string; module?: string; sourceRoot?: string; order: number; owner: string; replacement?: string; sourceHash?: string; outputHash?: string }>
  definitions: string[]
  stages: Plugin[]
  aliases: Alias[]
  logicalId(file: string): string
  virtual(specifier: string): string | null
  replacement(id: string, importer?: string): string
  alias(specifier: string): string
  transform(source: string, file: string): string
}
export function rendererAdapterPlugin(root: string): Plugin
