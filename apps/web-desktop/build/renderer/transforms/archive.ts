import path from 'node:path'
import { replaceBrowserContract } from './contract'

export function useBrowserArchiveUndo(source: string, root: string): string {
  source = replaceBrowserContract(source, [
    ['        await setSessionArchived(storedSessionId, true, profile)', `        const offerUndo = prepareBrowserArchiveUndo(storedSessionId, profile, archived)
        const result = await setSessionArchived(storedSessionId, true, profile)
        if (!result.ok) throw new Error('Gateway did not confirm the archive')`],
    ["        notify({ durationMs: 2_000, kind: 'success', message: copy.archived })", '        offerUndo()']
  ])
  return `import { prepareBrowserArchiveUndo } from ${JSON.stringify(path.join(root, 'src/upstream/archive-undo'))}\n` + source
}
