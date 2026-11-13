import { notificationChatTitle, notificationSnippet } from './android-notification-content.mjs'

export const replyLifetimeMs = 60 * 60 * 1000

export function replyNotificationHeaders(req, origin, cookies = []) {
  const jar = new Map()
  for (const part of [...String(req.headers.cookie || '').split(';'), ...cookies.map(cookie => cookie.split(';')[0])]) {
    const index = part.indexOf('=')
    if (index < 0) continue
    const name = part.slice(0, index).trim()
    // Keep the Hermes sign-in cookies in memory. The browser owns refresh-token rotation.
    if (/^(?:__Host-|__Secure-)?hermes_(?:session_(?:at|provider)|webapp_signin)(?:_[\w-]+)?$/.test(name)) {
      jar.set(name, part.slice(index + 1).trim())
    }
  }
  const url = new URL(origin)
  return {
    cookie: [...jar].filter(([, value]) => value).map(([name, value]) => name + '=' + value).join('; '),
    'x-hermes-session-token': req.headers['x-hermes-session-token'] || '',
    'x-forwarded-host': url.host,
    'x-forwarded-proto': url.protocol.slice(0, -1)
  }
}

function replyText(message) {
  if (typeof message?.display_content === 'string') return message.display_content
  if (typeof message?.content === 'string') return message.content
  return ''
}

export async function scanRecentReplies({ target, headers, request, since, signal, shouldInspect, onInspected, onReply }) {
  const read = async path => {
    const response = await request(target + path, {
      headers, redirect: 'manual', signal: AbortSignal.any([signal, AbortSignal.timeout(6000)])
    })
    if (response.status === 401 || response.status === 403) return null
    if (!response.ok) throw new Error('Hermes could not read recent chats')
    return response.json()
  }
  const list = await read('/api/profiles/sessions?profile=all&order=recent&limit=100&min_messages=1')
  if (!list) return false
  if (!Array.isArray(list.sessions)) throw new Error('Hermes returned an invalid chat list')
  for (const row of list.sessions) {
    if (signal.aborted) break
    if (!row || typeof row.id !== 'string' || !row.id || typeof row.profile !== 'string' || !row.profile ||
        row.archived || row.hidden || !(row.last_active * 1000 >= since) ||
        (row.source === 'cron' && row.end_reason !== 'cron_complete')) continue
    if (!shouldInspect(row)) continue
    const profile = new URLSearchParams({ profile: row.profile, order: 'latest', limit: '4', inline_images: 'false' })
    let page
    try { page = await read('/api/sessions/' + encodeURIComponent(row.id) + '/messages?' + profile) }
    catch { continue }
    if (!page) return false
    if (page.pagination?.order !== 'latest' || !Array.isArray(page.messages)) continue
    // Scheduled results arrive as persisted completion notes, with the user role.
    const message = page.messages.findLast(item => item?.role === 'user' || item?.role === 'assistant' || item?.role === 'tool')
    const metadata = message?.display_metadata
    const note = message?.role === 'user' && Array.isArray(metadata?.completion_note) && metadata.completion_note.length > 0
    const text = notificationSnippet(replyText(message))
    const timestamp = message?.timestamp * 1000
    if (metadata?.notification_category === 'diagnostic' || !text || /^\[SILENT\]$/i.test(text) || !(timestamp >= since) ||
        (row.last_read_at > 0 && message.timestamp <= row.last_read_at) ||
        ['hidden', 'failed_turn'].includes(message.display_kind) || message._compressed_summary ||
        message.tool_calls?.length || ['error', 'agent_error', 'content_filter', 'length'].includes(message.finish_reason) ||
        (!note && (message.role !== 'assistant' || message.display_kind === 'internal_notification'))) {
      onInspected(row)
      continue
    }
    const replyId = message.message_uid || message.id
    if (!replyId) continue
    onReply(row, {
      replyId, timestamp, chatTitle: notificationChatTitle(row.title), body: text
    })
    onInspected(row)
  }
  return true
}
