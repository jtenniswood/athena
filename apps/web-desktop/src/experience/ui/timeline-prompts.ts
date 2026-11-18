import {
  deriveTimelineEntries,
  EARLIER_TIMELINE_ID,
  type TimelineEntry,
  type TimelineSourceMessage
} from '../../upstream/browser-api'

const MAX_LANDMARKS = 16

// Hermes can persist generation scaffolding in user-role rows. Match their
// reserved openings so older gateways' truncated timeline previews work too.
const generatedPromptPrefixes = [
  "You've reached the maximum number of tool-calling iterations allowed. Please provide a final response",
  'Continue from the compressed conversation context above. This marker exists because ',
  '[STILL IN PROGRESS — this is the active request, restated after the ',
  'Your previous turn indicated a tool call but none was included. Do not narrate a plan',
  'You just executed tool calls but returned an empty response. Please process the tool',
  '[System: The previous response was cut off by a network error mid-stream',
  '[System: Your previous response was truncated by the output length limit.',
  '[System: Your previous tool call ',
  '[System: Your previous response contained only internal reasoning',
  '[System: Continue now. Execute the required tool calls',
  '[System: Your previous message ended the turn with a fragment',
  '[IMPORTANT: Background process ',
  '[Your active task list was preserved across context compression]',
  'A background subagent you dispatched earlier has finished.',
  'Cronjob Response: '
]

const generatedNotice = /^(?:\[ASYNC (?:DELEGATION )?(?:BATCH )?COMPLETE\b|\[Background process \S+ heartbeat #\d+ |A background fan-out of \d+ subagent\(s\) you dispatched earlier has finished\.)/i

export function isTimelinePromptText(text: string): boolean {
  const start = text.trimStart()
  return !generatedNotice.test(start) && !generatedPromptPrefixes.some(prefix => start.startsWith(prefix))
}

export function derivePromptEntries(rows: readonly TimelineSourceMessage[]) {
  return deriveTimelineEntries(rows.filter(row => isTimelinePromptText(row.text)))
}

/** Keep the endpoints and one representative prompt from each chronological slice. */
export function summarizeTimeline(entries: TimelineEntry[]) {
  if (entries.length <= MAX_LANDMARKS) {
    return { entries, indexes: entries.map((_, index) => index) }
  }

  const first = entries[0].id === EARLIER_TIMELINE_ID ? 1 : 0
  const last = entries.length - 1
  const indexes = first === 0 ? [0] : [0, first]
  const slices = MAX_LANDMARKS - indexes.length - 1
  const interior = last - first - 1

  for (let slice = 0; slice < slices; slice++) {
    const start = first + 1 + Math.floor(slice * interior / slices)
    const end = first + 1 + Math.floor((slice + 1) * interior / slices)
    let best = start
    let bestScore = -1

    for (let index = start; index < end; index++) {
      // Prefer prompts with more distinct words over short, repetitive follow-ups.
      const words = entries[index].preview.toLowerCase().match(/[\p{L}\p{N}]+/gu)
      const score = new Set(words).size
      if (score > bestScore) {
        best = index
        bestScore = score
      }
    }

    indexes.push(best)
  }

  indexes.push(last)
  return { entries: indexes.map(index => entries[index]), indexes }
}
