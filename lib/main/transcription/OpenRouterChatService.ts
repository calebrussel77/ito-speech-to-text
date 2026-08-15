import { LocalTranscriptionError } from './LocalTranscriptionService'
import { stripReasoning } from './reasoning'
import type { PinnedProvider } from '../../constants/modelCatalog'

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type OpenRouterChatOptions = {
  apiKey: string
  model: string
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  /**
   * Pin the upstream provider. Without it OpenRouter picks freely among the
   * twenty-odd hosts serving a model, whose prices and throughput span an
   * order of magnitude — so an unpinned "fastest" choice would not be one.
   */
  pinnedProvider?: PinnedProvider
  /**
   * Ce que le catalogue sait du raisonnement du modèle (`CatalogModel.reasoning`) :
   * `'none'` le coupe, `'low'` le réduit au minimum qu'un modèle à raisonnement
   * obligatoire accepte. Absent, on ne demande rien — un modèle qui ne raisonne
   * pas peut rejeter le champ.
   */
  reasoningEffort?: 'none' | 'low'
}

const CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions'
// Post-processing a transcript is a short, interactive call: a slow answer is
// worse than no answer, since the caller falls back to the raw transcript.
const REQUEST_TIMEOUT_MS = 30_000

// OpenRouter matches `provider.order` against display names, not slugs.
const PROVIDER_NAMES: Record<PinnedProvider, string> = {
  cerebras: 'Cerebras',
}

function mapFetchError(error: any): LocalTranscriptionError {
  const message = error?.message || 'OpenRouter request failed'
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

class OpenRouterChatService {
  async complete(options: OpenRouterChatOptions): Promise<string> {
    const apiKey = options.apiKey?.trim()
    if (!apiKey) {
      throw new LocalTranscriptionError(
        'OpenRouter API key is required',
        'MISSING_API_KEY',
      )
    }

    const body: Record<string, unknown> = {
      model: options.model,
      messages: options.messages,
      temperature: options.temperature ?? 0.1,
      ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
      // Le raisonnement n'a rien à faire dans un texte dicté. `exclude` vaut
      // pour tous les modèles ; `effort` vient du catalogue — `none` pour les
      // hybrides qui pensent par défaut, `low` pour ceux qui refusent de ne
      // pas penser. Le vrai filet reste `stripReasoning` plus bas — l'hôte
      // qui laisse fuir un `<think>` dans `content` est précisément celui qui
      // ignore ces champs.
      reasoning: {
        exclude: true,
        ...(options.reasoningEffort ? { effort: options.reasoningEffort } : {}),
      },
    }

    if (options.pinnedProvider) {
      body.provider = {
        order: [PROVIDER_NAMES[options.pinnedProvider]],
        // Falling back would silently hand the request to a slower, differently
        // priced host — exactly what pinning exists to prevent.
        allow_fallbacks: false,
      }
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
        `[OpenRouterChat] model=${options.model} cost=$${json.usage.cost}`,
      )
    }

    const content = json?.choices?.[0]?.message?.content
    return typeof content === 'string' ? stripReasoning(content) : ''
  }
}

export const openRouterChatService = new OpenRouterChatService()
