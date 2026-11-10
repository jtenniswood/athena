import type { ComponentType, ReactNode } from 'react'
import type { BrowserApproval, BrowserApprovalRequester, BrowserSessionActions } from './actions'
import type { BrowserContextUsage } from './context-usage'
import type { BrowserConversationModel } from './conversation'
import type { BrowserHostPanel, BrowserSidebarCommands } from './host'
import type { BrowserNewChatProfile, BrowserProfiles } from './profiles'
import type { BrowserNavigate, BrowserSessionSelection } from './selection'
import type { BrowserSettingsController, BrowserSettingsPageProps } from './settings'

/** Product-facing projections and commands. Every mutable chat value remains engine-owned. */
export interface BrowserEngine {
  readonly protocol: 1
  readonly surfaces: {
    Host: ComponentType<{ children: ReactNode }>
    Sessions: ComponentType
    Bots: ComponentType<{ fallback: ReactNode }>
    Conversation: ComponentType
    Status: ComponentType
    Page: ComponentType
    ProfileEditor: ComponentType<{ profile: string | null; onClose(): void }>
  }
  readonly conversations: {
    useContextUsage(conversation: BrowserConversationModel): BrowserContextUsage
    useCurrent(): BrowserConversationModel
    useActions(conversation: BrowserConversationModel): BrowserSessionActions
    select(selection: BrowserSessionSelection, navigate: BrowserNavigate): void
  }
  readonly profiles: {
    useProfiles(): BrowserProfiles
    useNewChat(): BrowserNewChatProfile
    useActive(): string
    useGrouping(): boolean
  }
  readonly navigation: {
    usePanels(): readonly BrowserHostPanel[]
    useSidebar(commands: BrowserSidebarCommands): { open: boolean; setOpen(open: boolean): void }
    openPage(navigate: BrowserNavigate, path: string): void
    coversWorkspace(pathname: string): boolean
  }
  readonly settings: {
    Controller: ComponentType<BrowserSettingsPageProps & { children(controller: BrowserSettingsController): ReactNode }>
  }
  readonly approval: {
    useRequest(): BrowserApprovalRequester
    useMode(profile: string, request: BrowserApprovalRequester): BrowserApproval
  }
  readonly projects: {
    eligibleDrop(projectId: string | undefined): string | null
    move(sessionId: string, projectId: string, profile: string): Promise<void>
    reportFailure(error: unknown): void
  }
  useEnvironment(conversation: BrowserConversationModel, visible: boolean): void
}
