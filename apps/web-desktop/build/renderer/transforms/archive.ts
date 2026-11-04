import path from 'node:path'
import { replaceBrowserContract } from './contract'

export function useBrowserArchiveUndo(source: string, root: string): string {
  const start = source.indexOf('  const archiveSession = useCallback(')
  const end = source.indexOf('  const unarchiveSession = useCallback(', start)
  if (start < 0 || end < 0) throw new Error('Browser archive command boundary changed')
  const archive = replaceBrowserContract(source.slice(start, end), [
    ['      const wasSelected = selectedStoredSessionIdRef.current === storedSessionId', `      try {
        if (!await confirmAndStopBrowserArchive(storedSessionId, profile, archived)) return
      } catch (error) {
        notifyError(error, copy.archiveFailed)
        return
      }

      const wasSelected = selectedStoredSessionIdRef.current === storedSessionId`]
  ])
  source = source.slice(0, start) + archive + source.slice(end)
  source = replaceBrowserContract(source, [
    ['        await setSessionArchived(storedSessionId, true, profile)', `        const offerUndo = prepareBrowserArchiveUndo(storedSessionId, profile, archived)
        const result = await setSessionArchived(storedSessionId, true, profile)
        if (!result.ok) throw new Error('Gateway did not confirm the archive')`],
    ["        notify({ durationMs: 2_000, kind: 'success', message: copy.archived })", '        offerUndo()']
  ])
  return `import { confirmAndStopBrowserArchive } from ${JSON.stringify(path.join(root, 'src/upstream/archive-running'))}\n` +
    `import { prepareBrowserArchiveUndo } from ${JSON.stringify(path.join(root, 'src/upstream/archive-undo'))}\n` + source
}
