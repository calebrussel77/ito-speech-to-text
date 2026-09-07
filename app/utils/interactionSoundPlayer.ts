import type { InteractionSoundPlayPayload } from '@/lib/types/ipc'

/**
 * Lecture du son de fin de dictée.
 *
 * Il jouait par un `<audio>` recréé à chaque fois depuis un blob : ouverture
 * du pipeline média, décodage, démarrage — dans une fenêtre cachée que
 * Chromium met en veille, cela prenait plusieurs secondes après le collage.
 * Ici le fichier est décodé une fois en mémoire et rejoué par Web Audio :
 * `start()` part dans la milliseconde, même à froid.
 */
let context: AudioContext | null = null
const decoded = new Map<string, Promise<AudioBuffer>>()
let activeSource: AudioBufferSourceNode | null = null

const getContext = () => {
  if (!context) context = new AudioContext()
  return context
}

const keyOf = (payload: InteractionSoundPlayPayload) =>
  `${payload.theme}:${payload.fileName}:${payload.audioData.byteLength}`

const decode = (payload: InteractionSoundPlayPayload) => {
  const key = keyOf(payload)
  let buffer = decoded.get(key)
  if (!buffer) {
    // Copie : decodeAudioData détache le tampon qu'on lui donne.
    const bytes = new Uint8Array(payload.audioData).slice().buffer
    buffer = getContext().decodeAudioData(bytes)
    buffer.catch(() => decoded.delete(key))
    decoded.set(key, buffer)
  }
  return buffer
}

export const playInteractionSoundPayload = async (
  payload: InteractionSoundPlayPayload,
) => {
  try {
    const ctx = getContext()
    const [buffer] = await Promise.all([
      decode(payload),
      ctx.state === 'suspended' ? ctx.resume() : Promise.resolve(),
    ])

    if (activeSource) {
      try {
        activeSource.stop()
      } catch {
        // déjà terminé
      }
    }
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(ctx.destination)
    source.onended = () => {
      if (activeSource === source) activeSource = null
    }
    activeSource = source
    source.start()
  } catch (error) {
    console.error(
      '[interactionSoundPlayer] Failed to play interaction sound:',
      error,
    )
  }
}
