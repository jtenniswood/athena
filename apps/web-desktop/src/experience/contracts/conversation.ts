/**
 * Browser-facing conversation identity.
 *
 * This module deliberately contains no renderer imports or stores. It is the
 * stable product contract between the browser shell and the upstream adapter.
 */
export type ConversationKind = 'bot' | 'group' | 'session' | 'unknown'
export type ConversationStatus = 'empty' | 'loading' | 'ready'

export interface BrowserConversation {
  kind: ConversationKind
  status: ConversationStatus
  id: string | null
  sessionId: string | null
  profile: string | null
  displayName: string | null
  connectionId: string | null
}

/** Stable across identity hydration; changes when the visible session/group changes. */
export interface BrowserConversationModel extends BrowserConversation {
  selectionKey: string
}

export interface ConversationSession {
  id?: unknown
  title?: unknown
  profile?: unknown
  hidden?: unknown
  connection_id?: unknown
}

export interface ConversationBot {
  name?: unknown
  display_name?: unknown
  connectionId?: unknown
  targetProfile?: unknown
  route?: { profile?: unknown; targetProfile?: unknown } | null
  canonical_session?: { id?: unknown; resolved_id?: unknown } | null
}

export interface ConversationInput {
  selectedSessionId: string | null
  selectedSessionOwner?: { connectionId: string; profile: string } | null
  selectedBotKey: string | null
  groupName: string | null
  sessions: readonly ConversationSession[]
  bots: readonly ConversationBot[]
  /** Exact current engine workspace owner; never a last-clicked roster fallback. */
  selectedBotOwner?: ConversationBot | null
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function flag(value: unknown): boolean {
  return value === true || value === 1 || value === 'true'
}

function botKey(bot: ConversationBot): string {
  return `${text(bot.connectionId) || 'legacy'}::${text(bot.name)}`
}

function botMatchesProfile(bot: ConversationBot, profile: string): boolean {
  return [bot.name, bot.route?.profile, bot.targetProfile, bot.route?.targetProfile].some(value => text(value) === profile)
}

function botSessionIds(bot: ConversationBot): string[] {
  return [bot.canonical_session?.id, bot.canonical_session?.resolved_id].map(text).filter(Boolean)
}

function emptyConversation(): BrowserConversation {
  return { kind: 'unknown', status: 'empty', id: null, sessionId: null, profile: null, displayName: null, connectionId: null }
}

function botConversation(bot: ConversationBot, sessionId: string, profile: string | null): BrowserConversation {
  return {
    kind: 'bot', status: 'ready', id: botKey(bot), sessionId, profile,
    displayName: text(bot.display_name) || text(bot.name) || null,
    connectionId: text(bot.connectionId) || null
  }
}

/**
 * Resolve visible identity from stable IDs. An unlisted canonical chat can use
 * its exact current engine owner. Other missing rows remain unknown while they
 * hydrate; a previously selected Bot must never supply another chat's identity.
 */
export function resolveConversationIdentity(input: ConversationInput): BrowserConversation {
  const groupName = text(input.groupName)
  if (groupName) {
    return { kind: 'group', status: 'ready', id: groupName, sessionId: null, profile: null, displayName: groupName, connectionId: null }
  }

  const selectedId = text(input.selectedSessionId)
  if (!selectedId) return emptyConversation()

  const selectedOwner = input.selectedSessionOwner
  const session = input.sessions.find(candidate => text(candidate.id) === selectedId &&
    (!selectedOwner || ((text(candidate.profile) || 'default') === selectedOwner.profile &&
      (!text(candidate.connection_id) || text(candidate.connection_id) === selectedOwner.connectionId))))
  if (!session) {
    const owner = input.selectedBotOwner
    if (owner && botSessionIds(owner).includes(selectedId) && (!selectedOwner || botMatchesProfile(owner, selectedOwner.profile))) {
      return { ...botConversation(owner, selectedId, selectedOwner?.profile || text(owner.name) || null), connectionId: selectedOwner?.connectionId || text(owner.connectionId) || null }
    }
    return { kind: 'unknown', status: 'loading', id: selectedId, sessionId: selectedId, profile: selectedOwner?.profile || null, displayName: null, connectionId: selectedOwner?.connectionId || null }
  }

  const profile = selectedOwner?.profile || text(session.profile) || null
  const bot = input.bots.find(candidate =>
    (botSessionIds(candidate).includes(selectedId) && (!selectedOwner || botMatchesProfile(candidate, selectedOwner.profile))) ||
    (flag(session.hidden) && text(input.selectedBotKey) === botKey(candidate) && (!profile || profile === text(candidate.name)))
  )

  if (bot) {
    return { ...botConversation(bot, selectedId, profile), connectionId: selectedOwner?.connectionId || text(bot.connectionId) || null }
  }

  return { kind: 'session', status: 'ready', id: selectedId, sessionId: selectedId, profile, displayName: text(session.title) || null, connectionId: selectedOwner?.connectionId || null }
}
