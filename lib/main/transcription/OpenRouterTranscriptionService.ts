import { LocalTranscriptionError } from './LocalTranscriptionService'
import {
  DEFAULT_LONG_VOICE_KEY,
  resolveModel,
} from '../../constants/modelCatalog'

export type OpenRouterTranscriptionOptions = {
  apiKey: string
  model?: string
  vocabulary?: string[]
  // ISO-639-1 hint; empty/undefined = auto-detect
  language?: string
  // Free-form context for engines that accept it (gpt-transcribe)
  customPrompt?: string
  fileType?: string
}

const TRANSCRIPTIONS_URL = 'https://openrouter.ai/api/v1/audio/transcriptions'
const KEY_CHECK_URL = 'https://openrouter.ai/api/v1/key'
// A 2.5 min dictation measured ~80s on gpt-transcribe; leave headroom for
// ~10 min recordings before the reliability layer takes over.
const REQUEST_TIMEOUT_MS = 180_000
// Both engines cap their hint lists at 100 terms.
const MAX_HINT_TERMS = 100

const DEFAULT_CONTEXT_PROMPT =
  "Dictée technique d'un développeur francophone. Français courant avec termes anglais de programmation (code-switching FR/EN)."

// Hints ride in provider.options.<slug>: OpenRouter ignores the top-level
// `prompt` field and only forwards options to the matched provider.
function buildRequestBody(
  base64Audio: string,
  options: OpenRouterTranscriptionOptions,
): Record<string, unknown> {
  const model =
    options.model || resolveModel(undefined, DEFAULT_LONG_VOICE_KEY).slug
  const vocabulary = (options.vocabulary || []).slice(0, MAX_HINT_TERMS)
  const language = options.language?.trim() || 'fr'
  const contextPrompt = options.customPrompt?.trim() || DEFAULT_CONTEXT_PROMPT

  const body: Record<string, unknown> = {
    model,
    input_audio: { data: base64Audio, format: options.fileType || 'wav' },
    temperature: 0,
    response_format: 'json',
  }

  if (model.includes('gpt-transcribe')) {
    // `languages` (plural) is gpt-transcribe's explicit code-switching channel.
    const languages = language === 'en' ? ['en'] : [language, 'en']
    body.provider = {
      options: {
        openai: {
          prompt: contextPrompt,
          ...(vocabulary.length > 0 ? { keywords: vocabulary } : {}),
          languages,
        },
      },
    }
  } else if (model.includes('voxtral')) {
    body.language = language
    if (vocabulary.length > 0) {
      body.provider = {
        options: { mistral: { context_bias: vocabulary } },
      }
    }
  } else {
    // Unknown engine typed in by hand: send the portable subset only.
    body.language = language
  }

  return body
}

function mapFetchError(error: any): LocalTranscriptionError {
  if (error instanceof LocalTranscriptionError) return error
  const message: string = error?.message || 'OpenRouter request failed'
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
    return new LocalTranscriptionError(
      'OpenRouter request timed out',
      'NETWORK',
    )
  }
  return new LocalTranscriptionError(message, 'NETWORK')
}

async function mapHttpError(res: Response): Promise<LocalTranscriptionError> {
  let detail = ''
  try {
    detail = (await res.text()).slice(0, 300)
  } catch {
    // keep empty detail
  }

  if (res.status === 401 || res.status === 403) {
    return new LocalTranscriptionError(
      'OpenRouter rejected the API key',
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
      'OpenRouter rate limit hit',
      'RATE_LIMIT',
      res.status,
      retryAfterMs,
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

class OpenRouterTranscriptionService {
  async transcribeAudio(
    audioBuffer: Buffer,
    options: OpenRouterTranscriptionOptions,
  ): Promise<string> {
    const apiKey = options.apiKey?.trim()
    if (!apiKey) {
      throw new LocalTranscriptionError(
        'OpenRouter API key is required',
        'MISSING_API_KEY',
      )
    }

    const body = buildRequestBody(audioBuffer.toString('base64'), options)

    let res: Response
    try {
      res = await fetch(TRANSCRIPTIONS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch (error: any) {
      throw mapFetchError(error)
    }

    if (!res.ok) {
      throw await mapHttpError(res)
    }

    let json: any
    try {
      json = await res.json()
    } catch {
      throw new LocalTranscriptionError(
        'OpenRouter returned a non-JSON response',
        'MODEL_ERROR',
        res.status,
      )
    }

    if (json?.usage?.cost !== undefined) {
      console.log(
        `[OpenRouterTranscription] model=${body.model} cost=$${json.usage.cost}`,
      )
    }

    const text = typeof json?.text === 'string' ? json.text.trim() : ''
    if (!text) {
      // An empty transcript on real speech means the engine failed silently
      // (seen with some engines in the bake-off). Throwing hands the audio to
      // the Groq fallback, whose own no-speech detection covers true silence.
      throw new LocalTranscriptionError(
        'OpenRouter returned an empty transcript',
        'MODEL_ERROR',
        res.status,
      )
    }
    return text
  }

  async testConnection(
    apiKey: string,
  ): Promise<{ ok: boolean; message?: string }> {
    if (!apiKey?.trim()) {
      return { ok: false, message: 'Enter an API key first' }
    }
    try {
      const res = await fetch(KEY_CHECK_URL, {
        headers: { Authorization: `Bearer ${apiKey.trim()}` },
        signal: AbortSignal.timeout(10_000),
      })
      if (res.ok) {
        return { ok: true, message: 'Connected to OpenRouter' }
      }
      if (res.status === 401 || res.status === 403) {
        return { ok: false, message: 'Invalid OpenRouter API key' }
      }
      return { ok: false, message: `OpenRouter returned HTTP ${res.status}` }
    } catch (error: any) {
      return {
        ok: false,
        message: error?.message || 'Unable to reach OpenRouter',
      }
    }
  }
}

export const openRouterTranscriptionService =
  new OpenRouterTranscriptionService()
