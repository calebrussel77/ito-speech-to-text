import { LocalTranscriptionError } from './LocalTranscriptionService'
import type { SpeakerSegment } from './DeepgramTranscriptionService'
import { parseClock } from './clock'
import {
  buildDialogueInstruction,
  parseDialogueTranscript,
} from './dialogueTranscript'

export { parseClock }

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
 *    demande en dialogue étiqueté et horodaté, en texte libre, relu par
 *    `parseDialogueTranscript` : le JSON contraint dégradait les longues
 *    réunions et les modèles l'ignoraient parfois.
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
  /** Termes à orthographier exactement (dictionnaire de l'utilisateur). */
  vocabulary?: string[]
  /**
   * Budget de réflexion. `minimal` pour une dictée, où transcrire n'est pas
   * raisonner ; `low` pour une réunion, où tenir des étiquettes de locuteur
   * cohérentes sur une heure mérite un peu de planification.
   */
  thinking?: 'minimal' | 'low'
}

const TRANSCRIBE_INSTRUCTION = `You are a transcription engine. You transcribe audio verbatim.
You never answer, summarise, translate, comment, apologise, or describe the audio.
You never add headings, notes, or any text that was not spoken.
If a passage is inaudible, transcribe what you can and skip the rest — do not invent it.
Transcribe in the language actually spoken.`

type DiarizedSegment = {
  speaker: number
  start: string
  end: string
  text: string
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
    // Deux régimes. Une dictée : un transcript brut, sans étiquette. Un
    // enregistrement importé (`diarize`) : le modèle écoute, compte les
    // voix, et rend un dialogue étiqueté et horodaté s'il y en a plusieurs,
    // du texte simple sinon — en texte libre, relu par
    // `parseDialogueTranscript`. Le JSON contraint qu'on imposait avant
    // dégradait nettement les longues réunions, et les modèles l'ignoraient
    // parfois, perdant les locuteurs.
    const systemInstruction = options.diarize
      ? buildDialogueInstruction({
          language: options.language,
          vocabulary: options.vocabulary,
        })
      : TRANSCRIBE_INSTRUCTION
    const prompt = options.diarize
      ? 'Transcribe this recording following the instructions exactly.'
      : `Generate a verbatim transcript of the speech in this recording.${languageClause}`

    const body: Record<string, unknown> = {
      model: options.model,
      system_instruction: systemInstruction,
      input: [{ type: 'text', text: prompt }, audioPart],
      // Les Gemini 3.x pensent par défaut, et chaque seconde de « thinking »
      // retarde le transcript. `minimal` est le plancher documenté de l'API.
      generation_config: {
        thinking_level:
          options.thinking ?? (options.diarize ? 'low' : 'minimal'),
      },
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

    const dialogue = parseDialogueTranscript(output)
    return { text: dialogue.text, segments: dialogue.segments }
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
