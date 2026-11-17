import { BrowserTreeAdd, BrowserTreeHeader, BrowserTreeMore } from '../experience/sidebar-tree'

export const browserWorkspaceChromePresentation = {
  Add: BrowserTreeAdd,
  More: BrowserTreeMore,
  Header: BrowserTreeHeader,
  Start: ({ label, onClick }: { label: string; onClick(): void }) =>
    <BrowserTreeAdd label={label} icon="git-branch" className="group-hover/section:opacity-100" onClick={onClick} />
}
