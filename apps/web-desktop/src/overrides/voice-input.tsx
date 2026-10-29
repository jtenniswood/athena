import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import { iconSize, Loader2, Square } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { ACTIVE_ICON_BTN, GHOST_ICON_BTN } from '@/app/chat/composer/control-classes'
import type { ChatBarState, VoiceStatus } from '@/app/chat/composer/types'

interface VoiceInputProps {
  autoSpeak: boolean
  disabled: boolean
  state: ChatBarState
  voiceStatus: VoiceStatus
  onDictate: () => void
  onStartConversation?: () => void
  onToggleAutoSpeak: () => void
}

function VoiceInput({ disabled, state, voiceStatus, onDictate }: VoiceInputProps) {
  const { t } = useI18n()
  const dictating = state.voice.active || voiceStatus !== 'idle'
  const label = voiceStatus === 'recording'
    ? t.composer.stopDictation
    : voiceStatus === 'transcribing'
      ? t.composer.transcribingDictation
      : t.composer.voiceDictation

  return (
    <Tip label={label} placement="control">
      <Button
        aria-label={label}
        aria-pressed={dictating}
        className={cn(GHOST_ICON_BTN, 'rounded-full p-0', dictating && ACTIVE_ICON_BTN)}
        data-browser-composer-action=""
        disabled={disabled || !state.voice.enabled || voiceStatus === 'transcribing'}
        onClick={() => {
          triggerHaptic(dictating ? 'close' : 'open')
          onDictate()
        }}
        size="icon"
        type="button"
        variant="ghost"
      >
        {voiceStatus === 'recording' ? (
          <Square className={cn('fill-current', iconSize.xs)} />
        ) : voiceStatus === 'transcribing' ? (
          <Loader2 className={cn('animate-spin', iconSize.sm)} />
        ) : (
          <Codicon name="mic" size="0.875rem" />
        )}
      </Button>
    </Tip>
  )
}

export { VoiceInput as VoiceFan, VoiceInput as VoiceMenu }
