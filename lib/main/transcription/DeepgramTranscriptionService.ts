import { LocalTranscriptionError } from './LocalTranscriptionService'

/**
 * Le chemin fichier : c'est lui qui fait sauter le plafond des 13 minutes.
 *
 * Les deux autres chemins envoient l'audio dans un corps JSON — en multipart
 * pour Groq, en base64 pour OpenRouter — ce qui plafonne à quelques minutes.
 * Deepgram accepte les octets bruts en corps de requête, donc des heures, et
 * rend en prime la séparation des locuteurs dont le mode Meeting a besoin.
 */

export type SpeakerSegment = {
  /** Index rendu par Deepgram, stable dans un enregistrement. */
  speaker: number
  /** Libellé affiché, renommable par l'utilisateur. */
  label: string
  startMs: number
  endMs: number
  text: string
}

export type DeepgramOptions = {
  apiKey: string
  model: string
  /** ISO-639-1, ou absent pour laisser Deepgram détecter. */
  language?: string
  diarize?: boolean
  /**
   * Type MIME du corps. Les dictées d'Ito sont du WAV ; un fichier importé
   * peut être n'importe quel conteneur, et annoncer le mauvais type fait
   * échouer le décodage côté Deepgram.
   */
  contentType?: string
}

const LISTEN_URL = 'https://api.deepgram.com/v1/listen'
// Une heure d'audio se transcrit en quelques minutes ; la marge couvre une
// réunion longue sur une connexion médiocre.
const REQUEST_TIMEOUT_MS = 900_000

type DeepgramWord = {
  word: string
  start: number
  end: number
  speaker?: number
  /**
   * Le mot avec ponctuation/casse restaurées par smart_format + punctuate.
   * Confirmé par la sonde live (étape 6) : absent du contrat initial, mais
   * présent sur chaque mot en pratique. On le préfère à `word` pour ne pas
   * jeter la ponctuation qu'on a explicitement demandée.
   */
  punctuated_word?: string
  // Confirmés par la sonde live mais non utilisés ici ; gardés en optionnel
  // pour ne pas faire échouer le typage sur des champs réels de l'API.
  confidence?: number
  speaker_confidence?: number
}

/** Regroupe les mots consécutifs d'un même locuteur en blocs lisibles. */
export function groupWordsBySpeaker(words: DeepgramWord[]): SpeakerSegment[] {
  const segments: SpeakerSegment[] = []

  for (const word of words) {
    if (word.speaker === undefined) continue
    const display = word.punctuated_word || word.word

    const last = segments.at(-1)
    if (last && last.speaker === word.speaker) {
      last.text += ` ${display}`
      last.endMs = Math.round(word.end * 1000)
      continue
    }

    segments.push({
      speaker: word.speaker,
      label: `Speaker ${word.speaker + 1}`,
      startMs: Math.round(word.start * 1000),
      endMs: Math.round(word.end * 1000),
      text: display,
    })
  }

  return segments
}

function buildUrl(options: DeepgramOptions): string {
  const params = new URLSearchParams({
    model: options.model,
    smart_format: 'true',
    punctuate: 'true',
    paragraphs: 'true',
  })
  if (options.language) params.set('language', options.language)
  if (options.diarize) params.set('diarize', 'true')
  return `${LISTEN_URL}?${params.toString()}`
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
      'Deepgram rejected the API key',
      'INVALID_API_KEY',
      res.status,
    )
  }
  if (res.status === 429) {
    const retryAfterHeader = res.headers.get('retry-after')
    const retryAfterMs = retryAfterHeader
      ? Number(retryAfterHeader) * 1000 || undefined
      : undefined
    return new LocalTranscriptionError(
      'Deepgram rate limit hit',
      'RATE_LIMIT',
      res.status,
      retryAfterMs,
    )
  }
  if (res.status >= 500) {
    return new LocalTranscriptionError(
      `Deepgram server error: ${detail || res.status}`,
      'NETWORK',
      res.status,
    )
  }
  return new LocalTranscriptionError(
    `Deepgram request failed (${res.status}): ${detail}`,
    'MODEL_ERROR',
    res.status,
  )
}

class DeepgramTranscriptionService {
  async transcribeAudio(
    wavAudio: Buffer,
    options: DeepgramOptions,
  ): Promise<{ text: string; segments: SpeakerSegment[] }> {
    const apiKey = options.apiKey?.trim()
    if (!apiKey) {
      throw new LocalTranscriptionError(
        'Deepgram API key is required for long recordings',
        'MISSING_API_KEY',
      )
    }

    let res: Response
    try {
      res = await fetch(buildUrl(options), {
        method: 'POST',
        headers: {
          Authorization: `Token ${apiKey}`,
          'Content-Type': options.contentType || 'audio/wav',
        },
        // Buffer is a Uint8Array at runtime; the cast is needed because the
        // bun-types fetch overloads resolve to a DOM lib.d.ts signature that
        // doesn't see it as assignable to BodyInit.
        body: wavAudio as unknown as BodyInit,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch (error: any) {
      const timedOut =
        error?.name === 'AbortError' || error?.name === 'TimeoutError'
      throw new LocalTranscriptionError(
        timedOut
          ? 'Deepgram request timed out'
          : error?.message || 'Deepgram request failed',
        'NETWORK',
      )
    }

    if (!res.ok) throw await mapHttpError(res)

    let json: any
    try {
      json = await res.json()
    } catch {
      throw new LocalTranscriptionError(
        'Deepgram returned a non-JSON response',
        'MODEL_ERROR',
        res.status,
      )
    }

    const alternative = json?.results?.channels?.[0]?.alternatives?.[0]
    const text: string = (alternative?.transcript || '').trim()

    if (!text) {
      // Un transcript vide sur de la vraie parole est un échec silencieux du
      // moteur ; le laisser passer insérerait du vide sans rien dire.
      throw new LocalTranscriptionError(
        'Deepgram returned an empty transcript',
        'MODEL_ERROR',
        res.status,
      )
    }

    const segments = options.diarize
      ? groupWordsBySpeaker(alternative?.words ?? [])
      : []

    console.log(
      `[Deepgram] model=${options.model} chars=${text.length} segments=${segments.length}`,
    )
    return { text, segments }
  }

  async testConnection(
    apiKey: string,
  ): Promise<{ ok: boolean; message?: string }> {
    if (!apiKey?.trim()) return { ok: false, message: 'Enter an API key first' }

    try {
      const res = await fetch('https://api.deepgram.com/v1/projects', {
        headers: { Authorization: `Token ${apiKey.trim()}` },
        signal: AbortSignal.timeout(10_000),
      })
      if (res.ok) return { ok: true, message: 'Connected to Deepgram' }
      if (res.status === 401 || res.status === 403) {
        return { ok: false, message: 'Invalid Deepgram API key' }
      }
      return { ok: false, message: `Deepgram returned HTTP ${res.status}` }
    } catch (error: any) {
      return {
        ok: false,
        message: error?.message || 'Unable to reach Deepgram',
      }
    }
  }
}

export const deepgramTranscriptionService = new DeepgramTranscriptionService()
