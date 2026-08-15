import { LocalTranscriptionError } from './LocalTranscriptionService'
import type { SpeakerSegment } from './DeepgramTranscriptionService'

/**
 * Gemini comme moteur de transcription de fichiers.
 *
 * Ce n'est pas un ASR : c'est un modèle multimodal à qui on demande une
 * transcription. La différence compte à trois endroits.
 *
 * 1. **Il peut refuser, résumer, ou répondre au contenu** au lieu de le
 *    transcrire. D'où une `system_instruction` qui ne laisse aucune autre
 *    sortie possible — c'est la seule protection, et elle vaut d'être lue
 *    avant de la modifier.
 * 2. **La diarisation n'est pas un drapeau mais un format de sortie.** On la
 *    demande en JSON structuré (`response_format`), parce qu'un transcript
 *    nommé en texte libre serait à re-parser à l'aveugle.
 * 3. **Les horodatages sont générés, pas mesurés.** Gemini les rend en MM:SS,
 *    parfois HH:MM:SS ; ils situent, ils ne synchronisent pas.
 *
 * Contrat REST : `POST /v1beta/interactions`, clé en en-tête `x-goog-api-key`,
 * texte rendu dans `output_text` ou `steps[].content[].text`.
 * https://ai.google.dev/gemini-api/docs/audio
 */

const INTERACTIONS_URL =
  'https://generativelanguage.googleapis.com/v1beta/interactions'
const UPLOAD_URL =
  'https://generativelanguage.googleapis.com/upload/v1beta/files'

/**
 * Au-delà, l'audio passe par le Files API plutôt que par le corps de la
 * requête. La doc audio annonce 20 Mo de requête totale, celle des fichiers
 * parle de 100 Mo : on prend la plus prudente, moins la marge du base64 (+33 %)
 * et du prompt. Une réunion d'une heure dépasse de toute façon largement.
 */
const INLINE_MAX_BYTES = 12 * 1024 * 1024

/** Une heure d'audio à lire, sur une connexion médiocre. */
const REQUEST_TIMEOUT_MS = 900_000
const UPLOAD_TIMEOUT_MS = 600_000

export type GoogleOptions = {
  apiKey: string
  /** Slug du catalogue, p. ex. `gemini-3.7-flash`. */
  model: string
  /** ISO-639-1, ou absent pour laisser le modèle détecter. */
  language?: string
  diarize?: boolean
  /** Type MIME du fichier. Gemini le refuse s'il ne correspond pas. */
  contentType?: string
  /** Nom affiché côté Google quand le fichier passe par le Files API. */
  displayName?: string
}

const TRANSCRIBE_INSTRUCTION = `You are a transcription engine. You transcribe audio verbatim.
You never answer, summarise, translate, comment, apologise, or describe the audio.
You never add headings, notes, or any text that was not spoken.
If a passage is inaudible, transcribe what you can and skip the rest — do not invent it.
Transcribe in the language actually spoken.`

/** Le schéma que Gemini doit remplir quand on veut les locuteurs séparés. */
const DIARIZED_SCHEMA = {
  type: 'object',
  properties: {
    segments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          speaker: {
            type: 'integer',
            description: 'Zero-based index, stable across the recording',
          },
          start: { type: 'string', description: 'MM:SS' },
          end: { type: 'string', description: 'MM:SS' },
          text: { type: 'string' },
        },
        required: ['speaker', 'start', 'end', 'text'],
      },
    },
  },
  required: ['segments'],
}

type DiarizedSegment = {
  speaker: number
  start: string
  end: string
  text: string
}

/**
 * `MM:SS` ou `HH:MM:SS` en millisecondes. Rend 0 sur une valeur illisible
 * plutôt que `NaN` : un horodatage faux décale un segment, un `NaN` casse tout
 * l'affichage de l'historique.
 */
export function parseClock(value: string): number {
  const parts = String(value ?? '')
    .trim()
    .split(':')
    .map(part => Number(part))
  if (parts.some(part => !Number.isFinite(part))) return 0

  const [hours, minutes, seconds] =
    parts.length === 3 ? parts : [0, parts[0] ?? 0, parts[1] ?? 0]
  return Math.max(0, (hours * 3600 + minutes * 60 + seconds) * 1000)
}

/** Les segments de Gemini, dans la forme que le reste de l'app manipule. */
export function toSpeakerSegments(
  segments: DiarizedSegment[],
): SpeakerSegment[] {
  return segments
    .filter(segment => segment?.text?.trim())
    .map(segment => ({
      speaker: Number(segment.speaker) || 0,
      label: `Speaker ${(Number(segment.speaker) || 0) + 1}`,
      startMs: parseClock(segment.start),
      endMs: parseClock(segment.end),
      text: segment.text.trim(),
    }))
}

/**
 * Le texte rendu par une interaction.
 *
 * Deux chemins parce que la doc en décrit deux : `output_text` pour la sortie
 * structurée, et les étapes pour le texte libre. Lire les deux évite d'avoir à
 * deviner lequel s'applique à quel modèle.
 */
function readOutputText(payload: any): string {
  if (typeof payload?.output_text === 'string') return payload.output_text

  const steps = Array.isArray(payload?.steps) ? payload.steps : []
  for (const step of steps) {
    const content = Array.isArray(step?.content) ? step.content : []
    for (const part of content) {
      if (part?.type === 'text' && typeof part.text === 'string') {
        return part.text
      }
    }
  }
  return ''
}

async function mapHttpError(res: Response): Promise<LocalTranscriptionError> {
  let detail = ''
  try {
    detail = (await res.text()).slice(0, 300)
  } catch {
    // detail reste vide
  }

  if (res.status === 400 && /api[_ ]?key/i.test(detail)) {
    return new LocalTranscriptionError(
      'Google rejected the API key',
      'INVALID_API_KEY',
      res.status,
    )
  }
  if (res.status === 401 || res.status === 403) {
    return new LocalTranscriptionError(
      'Google rejected the API key',
      'INVALID_API_KEY',
      res.status,
    )
  }
  if (res.status === 429) {
    return new LocalTranscriptionError(
      'Google rate limit hit',
      'RATE_LIMIT',
      res.status,
    )
  }
  if (res.status >= 500) {
    return new LocalTranscriptionError(
      `Google server error: ${detail || res.status}`,
      'NETWORK',
      res.status,
    )
  }
  return new LocalTranscriptionError(
    `Google request failed (${res.status}): ${detail}`,
    'MODEL_ERROR',
    res.status,
  )
}

class GoogleTranscriptionService {
  /**
   * Dépose le fichier sur le Files API et rend son URI.
   *
   * Deux requêtes : la première déclare la taille et le type et rend l'URL
   * d'envoi dans un en-tête, la seconde pousse les octets. Les fichiers y sont
   * supprimés au bout de 48 h par Google — rien à nettoyer côté app.
   */
  private async uploadFile(
    audio: Buffer,
    options: GoogleOptions,
  ): Promise<string> {
    const start = await fetch(UPLOAD_URL, {
      method: 'POST',
      headers: {
        'x-goog-api-key': options.apiKey,
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(audio.length),
        'X-Goog-Upload-Header-Content-Type': options.contentType || 'audio/wav',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        file: { display_name: options.displayName || 'ito-recording' },
      }),
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    })

    if (!start.ok) throw await mapHttpError(start)

    const uploadUrl = start.headers.get('x-goog-upload-url')
    if (!uploadUrl) {
      throw new LocalTranscriptionError(
        'Google did not return an upload URL',
        'MODEL_ERROR',
      )
    }

    const upload = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Content-Length': String(audio.length),
        'X-Goog-Upload-Offset': '0',
        'X-Goog-Upload-Command': 'upload, finalize',
      },
      body: audio as unknown as BodyInit,
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    })

    if (!upload.ok) throw await mapHttpError(upload)

    const payload: any = await upload.json()
    const uri = payload?.file?.uri
    if (!uri) {
      throw new LocalTranscriptionError(
        'Google accepted the upload but returned no file URI',
        'MODEL_ERROR',
      )
    }
    return uri
  }

  async transcribeAudio(
    audio: Buffer,
    options: GoogleOptions,
  ): Promise<{ text: string; segments: SpeakerSegment[] }> {
    const apiKey = options.apiKey?.trim()
    if (!apiKey) {
      throw new LocalTranscriptionError(
        'A Google API key is required for Gemini',
        'MISSING_API_KEY',
      )
    }

    const mimeType = options.contentType || 'audio/wav'
    const audioPart =
      audio.length > INLINE_MAX_BYTES
        ? {
            type: 'audio',
            uri: await this.uploadFile(audio, { ...options, apiKey }),
            mime_type: mimeType,
          }
        : {
            type: 'audio',
            data: audio.toString('base64'),
            mime_type: mimeType,
          }

    const languageClause = options.language
      ? ` The audio is in "${options.language}"; transcribe it in that language.`
      : ''
    const prompt = options.diarize
      ? `Transcribe this recording and attribute every segment to its speaker.${languageClause} Number the speakers from 0 in the order they first speak, and keep that numbering stable for the whole recording.`
      : `Generate a verbatim transcript of the speech in this recording.${languageClause}`

    const body: Record<string, unknown> = {
      model: options.model,
      system_instruction: TRANSCRIBE_INSTRUCTION,
      input: [{ type: 'text', text: prompt }, audioPart],
    }
    if (options.diarize) {
      body.response_format = {
        type: 'text',
        mime_type: 'application/json',
        schema: DIARIZED_SCHEMA,
      }
    }

    let res: Response
    try {
      res = await fetch(INTERACTIONS_URL, {
        method: 'POST',
        headers: {
          'x-goog-api-key': apiKey,
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
          ? 'Google request timed out'
          : error?.message || 'Google request failed',
        'NETWORK',
      )
    }

    if (!res.ok) throw await mapHttpError(res)

    const payload: any = await res.json()
    const output = readOutputText(payload).trim()

    if (!output) {
      throw new LocalTranscriptionError(
        'Gemini returned nothing for this recording',
        'MODEL_ERROR',
      )
    }

    if (!options.diarize) return { text: output, segments: [] }

    // La sortie structurée est une CHAÎNE JSON, pas un objet : un modèle qui
    // rend malgré tout du texte libre ne doit pas faire échouer la
    // transcription — on garde alors ce qu'il a dit, sans les locuteurs.
    try {
      const parsed = JSON.parse(output)
      const segments = toSpeakerSegments(parsed?.segments ?? [])
      if (!segments.length) return { text: output, segments: [] }
      return {
        text: segments.map(segment => segment.text).join(' '),
        segments,
      }
    } catch {
      console.warn(
        '[GoogleTranscriptionService] Expected diarized JSON, got free text',
      )
      return { text: output, segments: [] }
    }
  }

  /** Vérifie qu'une clé répond, sans dépenser de transcription. */
  async testConnection(
    apiKey: string,
  ): Promise<{ ok: boolean; message: string }> {
    if (!apiKey?.trim()) {
      return { ok: false, message: 'Enter a key first' }
    }
    try {
      const res = await fetch(INTERACTIONS_URL, {
        method: 'POST',
        headers: {
          'x-goog-api-key': apiKey.trim(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gemini-3.5-flash-lite',
          input: 'ping',
        }),
        signal: AbortSignal.timeout(20_000),
      })
      if (res.ok) return { ok: true, message: 'Key works' }
      const error = await mapHttpError(res)
      return { ok: false, message: error.message }
    } catch (error: any) {
      return { ok: false, message: error?.message || 'Unable to reach Google' }
    }
  }
}

export const googleTranscriptionService = new GoogleTranscriptionService()
