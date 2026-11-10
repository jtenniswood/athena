import { deriveTimelineEntries, type TimelineSourceMessage } from '@/components/assistant-ui/thread/timeline-data'

// Hermes can persist generation scaffolding in user-role rows. Match their
// reserved openings so older gateways' truncated timeline previews work too.
const generatedPromptPrefixes = [
  "You've reached the maximum number of tool-calling iterations allowed. Please provide a final response",
  'Continue from the compressed conversation context above. This marker exists because ',
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
