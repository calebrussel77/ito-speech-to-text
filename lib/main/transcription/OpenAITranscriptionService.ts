import { LocalTranscriptionError } from './LocalTranscriptionService'
import type { SpeakerSegment } from './DeepgramTranscriptionService'

/**
 * OpenAI en direct comme moteur de transcription de fichiers.
 *
 * Contrairement à Gemini, c'est un vrai endpoint ASR : `POST
 * /v1/audio/transcriptions` en multipart, pas un modèle de chat à qui on
 * demande une transcription. Trois particularités, toutes vérifiées contre
 * l'API réelle le 2026-08-15 :
 *
 * 1. **La diarisation est un modèle, pas un drapeau.** Seul
 *    `gpt-4o-transcribe-diarize` sépare les locuteurs, via
 *    `response_format=diarized_json` + `chunking_strategy=auto` (obligatoire
 *    au-delà de 30 s). Les autres modèles rendent du texte simple.
 * 2. **Le paramètre de langue change de forme selon le modèle** :
 *    `languages[]` (pluriel) pour gpt-transcribe, `language` (singulier) pour
 *    la famille gpt-4o. La doc interdit d'envoyer les deux.
 * 3. **Les locuteurs sont des lettres** (`"A"`, `"B"`…), les horodatages des
 *    secondes flottantes — on les ramène à la forme que le reste de l'app
 *    manipule (index numérique, millisecondes).
 *
 * https://developers.openai.com/api/docs/guides/speech-to-text
 */

const TRANSCRIPTIONS_URL = 'https://api.openai.com/v1/audio/transcriptions'
const MODELS_URL = 'https://api.openai.com/v1/models'

/** Plafond documenté de l'endpoint. Au-delà, l'API refuse le fichier. */
export const OPENAI_MAX_BYTES = 25 * 1024 * 1024

/** Une heure d'audio à transcrire, sur une connexion médiocre. */
const REQUEST_TIMEOUT_MS = 900_000

export type OpenAIOptions = {
  apiKey: string
  /** Slug du catalogue, p. ex. `gpt-transcribe`. */
  model: string
  /** ISO-639-1, ou absent pour laisser le modèle détecter. */
  language?: string
  diarize?: boolean
  /** Type MIME du fichier. */
  contentType?: string
  /** Nom envoyé en multipart — OpenAI déduit le format de son extension. */
  fileName?: string
  /** Termes à orthographier exactement, passés dans le `prompt` du modèle. */
  vocabulary?: string[]
}

/** Le seul modèle du catalogue qui sait séparer les locuteurs. */
const DIARIZE_MODEL = 'gpt-4o-transcribe-diarize'

type DiarizedSegment = {
  text: string
  speaker: string
  start: number
  end: number
}

/**
 * Les segments d'OpenAI, dans la forme que le reste de l'app manipule.
 * L'index d'un locuteur est son ordre de première prise de parole, pas sa
 * lettre : l'API promet `A`, `B`… mais un identifiant inattendu (`unknown`,
 * un nom connu via `known_speaker_names`) ne doit pas produire d'index faux.
 */
export function toSpeakerSegments(
  segments: DiarizedSegment[],
): SpeakerSegment[] {
  const indexBySpeaker = new Map<string, number>()
  return segments
    .filter(segment => segment?.text?.trim())
    .map(segment => {
      const speakerId = String(segment.speaker ?? '')
      if (!indexBySpeaker.has(speakerId)) {
        indexBySpeaker.set(speakerId, indexBySpeaker.size)
      }
      const index = indexBySpeaker.get(speakerId)!
      return {
        speaker: index,
        label: `Speaker ${index + 1}`,
        startMs: Math.max(0, Math.round((Number(segment.start) || 0) * 1000)),
        endMs: Math.max(0, Math.round((Number(segment.end) || 0) * 1000)),
        text: segment.text.trim(),
      }
    })
}

async function mapHttpError(res: Response): Promise<LocalTranscriptionError> {
  let detail = ''
  try {
    const payload: any = await res.json()
    detail = payload?.error?.message || ''
  } catch {
    // detail reste vide
  }

  if (res.status === 401 || res.status === 403) {
    return new LocalTranscriptionError(
      'OpenAI rejected the API key',
      'INVALID_API_KEY',
      res.status,
    )
  }
  if (res.status === 429) {
    return new LocalTranscriptionError(
      'OpenAI rate limit hit',
      'RATE_LIMIT',
      res.status,
    )
  }
  if (res.status >= 500) {
    return new LocalTranscriptionError(
      `OpenAI server error: ${detail || res.status}`,
      'NETWORK',
      res.status,
    )
  }
  return new LocalTranscriptionError(
    `OpenAI request failed (${res.status}): ${detail}`,
    'MODEL_ERROR',
    res.status,
  )
}

class OpenAITranscriptionService {
  async transcribeAudio(
    audio: Buffer,
    options: OpenAIOptions,
  ): Promise<{ text: string; segments: SpeakerSegment[] }> {
    const apiKey = options.apiKey?.trim()
    if (!apiKey) {
      throw new LocalTranscriptionError(
        'An OpenAI API key is required',
        'MISSING_API_KEY',
      )
    }
    if (audio.length > OPENAI_MAX_BYTES) {
      throw new LocalTranscriptionError(
        `This file is ${Math.round(audio.length / 1024 / 1024)} MB — OpenAI accepts 25 MB at most. Pick Deepgram or Gemini for it in Models.`,
        'MODEL_ERROR',
      )
    }

    const diarize = options.diarize && options.model === DIARIZE_MODEL

    const buildForm = (withPrompt: boolean) => {
      const form = new FormData()
      form.append(
        'file',
        new Blob([new Uint8Array(audio)], {
          type: options.contentType || 'audio/wav',
        }),
        options.fileName || 'audio.wav',
      )
      form.append('model', options.model)
      if (options.language) {
        // gpt-transcribe attend `languages[]`, la famille gpt-4o `language` —
        // et la doc interdit d'envoyer les deux à la fois.
        const plural = options.model.startsWith('gpt-transcribe')
        form.append(plural ? 'languages[]' : 'language', options.language)
      }
      if (diarize) {
        form.append('response_format', 'diarized_json')
        // Obligatoire dès que l'audio dépasse 30 s ; inoffensif en deçà.
        form.append('chunking_strategy', 'auto')
      }
      const vocabulary = (options.vocabulary ?? []).filter(v => v.trim())
      if (withPrompt && vocabulary.length > 0) {
        // Le `prompt` d'OpenAI guide l'orthographe, pas le contenu : une liste
        // de noms propres est exactement ce pour quoi il existe.
        form.append('prompt', `Vocabulaire : ${vocabulary.join(', ')}.`)
      }
      return form
    }

    // Le `prompt` n'est pas documenté pour tous les modèles de la famille ;
    // s'il est refusé, on renvoie la même requête sans lui plutôt que de
    // perdre la transcription pour une liste de noms.
    let res: Response
    let withPrompt = true
    for (;;) {
      try {
        res = await fetch(TRANSCRIPTIONS_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}` },
          body: buildForm(withPrompt),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
      } catch (error: any) {
        const timedOut =
          error?.name === 'AbortError' || error?.name === 'TimeoutError'
        throw new LocalTranscriptionError(
          timedOut
            ? 'OpenAI request timed out'
            : error?.message || 'OpenAI request failed',
          'NETWORK',
        )
      }
      if (res.status === 400 && withPrompt) {
        const detail = await res
          .clone()
          .text()
          .catch(() => '')
        if (/prompt/i.test(detail)) {
          console.warn(
            '[OpenAITranscriptionService] prompt refused, retrying without it',
          )
          withPrompt = false
          continue
        }
      }
      break
    }
    if (!res.ok) throw await mapHttpError(res)

    const payload: any = await res.json()
    const text = typeof payload?.text === 'string' ? payload.text.trim() : ''

    if (!text) {
      throw new LocalTranscriptionError(
        'OpenAI returned nothing for this recording',
        'MODEL_ERROR',
      )
    }

    if (!diarize) return { text, segments: [] }

    const segments = toSpeakerSegments(
      Array.isArray(payload?.segments) ? payload.segments : [],
    )
    // Un JSON diarisé sans segments reste une transcription valide : on garde
    // le texte, simplement sans les locuteurs.
    if (!segments.length) return { text, segments: [] }
    return { text: segments.map(segment => segment.text).join(' '), segments }
  }

  /** Vérifie qu'une clé répond, sans dépenser de transcription. */
  async testConnection(
    apiKey: string,
  ): Promise<{ ok: boolean; message: string }> {
    if (!apiKey?.trim()) {
      return { ok: false, message: 'Enter a key first' }
    }
    try {
      const res = await fetch(MODELS_URL, {
        headers: { Authorization: `Bearer ${apiKey.trim()}` },
        signal: AbortSignal.timeout(20_000),
      })
      if (res.ok) return { ok: true, message: 'Key works' }
      const error = await mapHttpError(res)
      return { ok: false, message: error.message }
    } catch (error: any) {
      return { ok: false, message: error?.message || 'Unable to reach OpenAI' }
    }
  }
}

export const openaiTranscriptionService = new OpenAITranscriptionService()
