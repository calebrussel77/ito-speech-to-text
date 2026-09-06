import { LocalTranscriptionError } from './LocalTranscriptionService'
import type { SpeakerSegment } from './DeepgramTranscriptionService'
import {
  buildDialogueInstruction,
  parseDialogueTranscript,
} from './dialogueTranscript'
import { stripReasoning } from './reasoning'

/**
 * Un modèle multimodal servi par OpenRouter (Gemini, en pratique) à qui on
 * confie un enregistrement entier et le brief de transcription en dialogue.
 *
 * C'est le chemin de ceux qui n'ont qu'une clé OpenRouter : le même modèle
 * et le même brief que le chemin Google direct, à travers l'endpoint chat
 * d'OpenRouter, qui accepte l'audio en base64 dans le message. Mesuré sur
 * une vraie réunion de prospection : dix minutes transcrites en dialogue à
 * quatre voix en une minute, pour deux centimes.
 */

const CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions'
/** Une heure d'audio à lire et à écrire ; la marge couvre une file d'attente. */
const REQUEST_TIMEOUT_MS = 30 * 60 * 1000

export type OpenRouterAudioOptions = {
  apiKey: string
  /** Slug OpenRouter, p. ex. `google/gemini-3.7-flash`. */
  model: string
  /** ISO-639-1 ; pilote la langue des étiquettes et l'attente linguistique. */
  language?: string
  vocabulary?: string[]
  /** `mp3` ou `wav` : les deux formats qu'OpenRouter accepte en entrée. */
  format: 'mp3' | 'wav'
}

async function mapHttpError(res: Response): Promise<LocalTranscriptionError> {
  let detail = ''
  try {
    detail = (await res.text()).slice(0, 300)
  } catch {
    // detail reste vide
  }
  if (res.status === 401 || res.status === 403) {
    return new LocalTranscriptionError(
      'OpenRouter rejected the API key',
      'INVALID_API_KEY',
      res.status,
    )
  }
  if (res.status === 413) {
    return new LocalTranscriptionError(
      'The recording is too large for OpenRouter in one request',
      'MODEL_ERROR',
      res.status,
    )
  }
  if (res.status === 429) {
    return new LocalTranscriptionError(
      'OpenRouter rate limit hit',
      'RATE_LIMIT',
      res.status,
    )
  }
  if (res.status >= 500) {
    return new LocalTranscriptionError(
      `OpenRouter server error: ${detail || res.status}`,
      'NETWORK',
      res.status,
    )
  }
  return new LocalTranscriptionError(
    `OpenRouter request failed (${res.status}): ${detail}`,
    'MODEL_ERROR',
    res.status,
  )
}

class OpenRouterAudioService {
  async transcribeAudio(
    audio: Buffer,
    options: OpenRouterAudioOptions,
  ): Promise<{ text: string; segments: SpeakerSegment[] }> {
    const apiKey = options.apiKey?.trim()
    if (!apiKey) {
      throw new LocalTranscriptionError(
        'An OpenRouter API key is required',
        'MISSING_API_KEY',
      )
    }

    const body = {
      model: options.model,
      messages: [
        {
          role: 'system',
          content: buildDialogueInstruction({
            language: options.language,
            vocabulary: options.vocabulary,
          }),
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Transcribe this recording following the instructions exactly.',
            },
            {
              type: 'input_audio',
              input_audio: {
                data: audio.toString('base64'),
                format: options.format,
              },
            },
          ],
        },
      ],
      temperature: 0.1,
      // Tenir des étiquettes cohérentes sur une heure mérite un peu de
      // planification, pas une réflexion longue qui retarderait tout.
      reasoning: { effort: 'low' },
    }

    let res: Response
    try {
      res = await fetch(CHAT_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch (error: any) {
      const timedOut =
        error?.name === 'AbortError' || error?.name === 'TimeoutError'
      throw new LocalTranscriptionError(
        timedOut
          ? 'OpenRouter request timed out'
          : error?.message || 'OpenRouter request failed',
        'NETWORK',
      )
    }
    if (!res.ok) throw await mapHttpError(res)

    const payload: any = await res.json()
    const content = payload?.choices?.[0]?.message?.content
    const output = (
      typeof content === 'string' ? stripReasoning(content) : ''
    ).trim()
    if (!output) {
      throw new LocalTranscriptionError(
        'OpenRouter returned nothing for this recording',
        'MODEL_ERROR',
      )
    }
    const dialogue = parseDialogueTranscript(output)
    return { text: dialogue.text, segments: dialogue.segments }
  }
}

export const openRouterAudioService = new OpenRouterAudioService()
