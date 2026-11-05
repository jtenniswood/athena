import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'

/** Deterministic local model for exercising a real Hermes gateway without a provider account. */
export const server = createServer((req, res) => { void (async () => {
  if (req.url === '/v1/models') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ object: 'list', data: [{ id: 'athena-test-model', object: 'model', owned_by: 'local-review' }] }))
    return
  }
  if (req.url !== '/v1/chat/completions' || req.method !== 'POST') {
    res.writeHead(404); res.end(); return
  }
  let raw = ''
  for await (const chunk of req) {
    raw += chunk
    if (raw.length > 4 * 1024 * 1024) throw new Error('Fixture request is too large')
  }
  const body = JSON.parse(raw)
  const user = body.messages?.findLast(message => message.role === 'user')?.content
  const text = typeof user === 'string' ? user : 'Review conversation'
  const answer = `Local review response: ${text.slice(0, 160)}`
  const id = `chatcmpl-${randomUUID()}`
  const base = { id, model: body.model || 'athena-test-model', created: Math.floor(Date.now() / 1000) }
  if (!body.stream) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ...base, object: 'chat.completion', choices: [{ index: 0,
      message: { role: 'assistant', content: answer }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }))
    return
  }
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' })
  for (const content of answer.split(/(?<=\s)/)) {
    if (res.destroyed) return
    res.write(`data: ${JSON.stringify({ ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`)
    await new Promise(resolve => setTimeout(resolve, text.includes('[slow]') ? 300 : 10))
  }
  res.end(`data: ${JSON.stringify({ ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`)
})().catch(() => { res.writeHead(400); res.end() }) })

server.listen(Number(process.env.PORT || 4191), process.env.HOST || '127.0.0.1', () => {
  console.log(`Local model fixture listening on ${server.address().port}`)
})
