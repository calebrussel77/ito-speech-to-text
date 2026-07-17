import type { InteractionSoundPlayPayload } from '@/lib/types/ipc'

let activeAudio: HTMLAudioElement | null = null
let activeBlobUrl: string | null = null

const clearActiveAudio = () => {
  if (activeAudio) {
    activeAudio.pause()
    activeAudio = null
  }

  if (activeBlobUrl) {
    URL.revokeObjectURL(activeBlobUrl)
    activeBlobUrl = null
  }
}

export const playInteractionSoundPayload = async (
  payload: InteractionSoundPlayPayload,
) => {
  try {
    clearActiveAudio()

    const audioBytes = new Uint8Array(payload.audioData)
    const blob = new Blob([audioBytes], { type: payload.mimeType })
    const blobUrl = URL.createObjectURL(blob)
    const audio = new Audio(blobUrl)
    audio.preload = 'auto'

    activeBlobUrl = blobUrl
    activeAudio = audio

    const cleanup = () => {
      if (activeBlobUrl === blobUrl) {
        URL.revokeObjectURL(blobUrl)
        activeBlobUrl = null
      }
      if (activeAudio === audio) {
        activeAudio = null
      }
    }

    audio.onended = cleanup
    audio.onerror = cleanup

    await audio.play()
  } catch (error) {
    console.error('[interactionSoundPlayer] Failed to play interaction sound:', error)
  }
}
