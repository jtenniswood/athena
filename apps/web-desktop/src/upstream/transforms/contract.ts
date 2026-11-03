export function replaceBrowserContract(source: string, changes: [string, string][]): string {
  for (const [before, after] of changes) {
    if (source.split(before).length !== 2) throw new Error('Browser semantic hook target changed: ' + before)
    source = source.replace(before, after)
  }
  return source
}
