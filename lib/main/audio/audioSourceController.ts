import type { Mode } from '../sqlite/models'

/**
 * Traduit la source et la politique de lecture d'un mode en décision de
 * mute pour `voiceInputService.startAudioRecording`.
 *
 * Le mode décide, `settings.muteAudioWhenDictating` n'est plus qu'un défaut
 * proposé à la création d'un mode (voir `modePresets.ts`) — il n'intervient
 * plus ici. Sans cette règle, muter les autres applications pendant qu'on
 * capture le système viderait la capture de tout contenu : c'est exactement
 * ce qui silencerait le mode Meeting (`audioSource: 'both'`) si sa politique
 * de lecture pouvait quand même déclencher un mute.
 */
export function shouldMuteForMode(
  mode: Pick<Mode, 'audioSource' | 'playbackWhenRecording'>,
): boolean {
  return (
    mode.playbackWhenRecording === 'mute' && mode.audioSource === 'microphone'
  )
}
