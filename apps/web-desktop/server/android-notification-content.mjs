const placeholderTitle = /^(?:new (?:chat|conversation)|untitled(?: (?:chat|conversation))?)$/i

export function notificationSnippet(value, max = 180) {
  if (typeof value !== 'string') return ''
  const text = value.trim().replace(/\s+/g, ' ')
  const characters = Array.from(text)
  return characters.length > max ? characters.slice(0, max - 1).join('').trimEnd() + '…' : text
}

export function notificationChatTitle(value) {
  const title = notificationSnippet(value, 100)
  return title && !placeholderTitle.test(title) ? title : ''
}
