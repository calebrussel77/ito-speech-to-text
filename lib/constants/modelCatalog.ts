/**
 * The curated model catalogue.
 *
 * Settings store a `key` from this file, never a raw model slug: the catalogue
 * owns everything else — which provider serves the model, which upstream it is
 * pinned to, what it costs, how fast it is, whose logo to draw. That makes the
 * incoherent state "model X at provider Y, which does not serve it" impossible
 * to represent.
 *
 * The list is deliberately closed and hand-picked. Provider catalogues run to
 * hundreds of entries, most of them irrelevant to dictation, and a model that
 * disappears upstream has to be migrated here anyway (see the Groq shutdown of
 * 2026-08-16). A key that is no longer listed falls back to the default.
 */

/** Who we actually send the request to. */
export type CatalogProvider = 'groq' | 'openrouter'

/**
 * Upstream provider pinned inside OpenRouter, via `provider.order`. Without a
 * pin OpenRouter picks freely, which makes both latency and price unknowable —
 * unacceptable in a picker whose whole point is choosing a speed.
 */
export type PinnedProvider = 'cerebras'

/** Whose logo goes on the row. Not the same thing as the provider. */
export type ModelLab =
  | 'anthropic'
  | 'cerebras'
  | 'deepgram'
  | 'google'
  | 'groq'
  | 'mistral'
  | 'openai'
  | 'qwen'
  | 'zai'

export type ModelKind = 'voice' | 'text'

export interface CatalogModel {
  /** Stable identifier persisted in settings. Never reuse one. */
  key: string
  kind: ModelKind
  /** Display name. */
  label: string
  /** The id sent over the wire to `provider`. */
  slug: string
  provider: CatalogProvider
  pinnedProvider?: PinnedProvider
  lab: ModelLab
  /**
   * Human-readable price, already carrying its unit. `null` where no
   * trustworthy figure exists: OpenRouter's `pricing` field mixes $/second,
   * $/minute and $/token between providers for the audio models, so publishing
   * it would be inventing a comparison.
   */
  price: string | null
  /**
   * 1-5 gauges, only where the figure is measured and published. Groq and
   * Cerebras document throughput; OpenRouter reports `p50_throughput: null`
   * for every model, so those rows stay blank rather than guessed.
   */
  speed?: number
  accuracy?: number
  /** Short tag shown next to the name. */
  note?: string
  /** Validated on real dictations during the long-form engine bake-off. */
  proven?: boolean
}

export const VOICE_MODELS: CatalogModel[] = [
  {
    key: 'whisper-large-v3',
    kind: 'voice',
    label: 'Whisper Large v3',
    slug: 'whisper-large-v3',
    provider: 'groq',
    lab: 'openai',
    price: '$0.111 / h',
    speed: 4,
    accuracy: 4,
    note: 'Most accurate',
  },
  {
    key: 'whisper-large-v3-turbo',
    kind: 'voice',
    label: 'Whisper Large v3 Turbo',
    slug: 'whisper-large-v3-turbo',
    provider: 'groq',
    lab: 'openai',
    price: '$0.04 / h',
    speed: 5,
    accuracy: 3,
    note: 'Cheapest',
  },
  {
    key: 'gpt-transcribe',
    kind: 'voice',
    label: 'GPT Transcribe',
    slug: 'openai/gpt-transcribe',
    provider: 'openrouter',
    lab: 'openai',
    price: '$0.0045 / min',
    proven: true,
  },
  {
    key: 'voxtral-mini-transcribe',
    kind: 'voice',
    label: 'Voxtral Mini Transcribe',
    slug: 'mistralai/voxtral-mini-transcribe',
    provider: 'openrouter',
    lab: 'mistral',
    price: '$0.003 / min',
    proven: true,
  },
  {
    key: 'nova-3',
    kind: 'voice',
    label: 'Nova 3',
    slug: 'deepgram/nova-3',
    provider: 'openrouter',
    lab: 'deepgram',
    price: '$0.0043 / min',
  },
  {
    key: 'chirp-3',
    kind: 'voice',
    label: 'Chirp 3',
    slug: 'google/chirp-3',
    provider: 'openrouter',
    lab: 'google',
    price: null,
  },
  {
    key: 'qwen3-asr-flash',
    kind: 'voice',
    label: 'Qwen3 ASR Flash',
    slug: 'qwen/qwen3-asr-flash-2026-02-10',
    provider: 'openrouter',
    lab: 'qwen',
    price: null,
  },
  {
    key: 'whisper-large-v3-turbo-openrouter',
    kind: 'voice',
    label: 'Whisper Large v3 Turbo',
    slug: 'openai/whisper-large-v3-turbo',
    provider: 'openrouter',
    lab: 'openai',
    price: null,
  },
  {
    key: 'voxtral-small-stt',
    kind: 'voice',
    label: 'Voxtral Small 24B STT',
    slug: 'mistralai/voxtral-small-24b-2507-stt',
    provider: 'openrouter',
    lab: 'mistral',
    price: null,
  },
  {
    key: 'gpt-4o-transcribe',
    kind: 'voice',
    label: 'GPT-4o Transcribe',
    slug: 'openai/gpt-4o-transcribe',
    provider: 'openrouter',
    lab: 'openai',
    price: '$0.006 / min',
  },
]

export const TEXT_MODELS: CatalogModel[] = [
  {
    key: 'gpt-oss-20b-groq',
    kind: 'text',
    label: 'GPT-OSS 20B',
    slug: 'openai/gpt-oss-20b',
    provider: 'groq',
    lab: 'openai',
    price: '$0.075 / $0.30 per M',
    speed: 4,
    note: 'Default',
  },
  {
    key: 'gpt-oss-120b-groq',
    kind: 'text',
    label: 'GPT-OSS 120B',
    slug: 'openai/gpt-oss-120b',
    provider: 'groq',
    lab: 'openai',
    price: '$0.15 / $0.60 per M',
    speed: 3,
  },
  {
    key: 'qwen3-27b-groq',
    kind: 'text',
    label: 'Qwen3.6 27B',
    slug: 'qwen/qwen3.6-27b',
    provider: 'groq',
    lab: 'qwen',
    price: null,
  },
  {
    key: 'gpt-oss-120b-cerebras',
    kind: 'text',
    label: 'GPT-OSS 120B',
    slug: 'openai/gpt-oss-120b',
    provider: 'openrouter',
    pinnedProvider: 'cerebras',
    lab: 'cerebras',
    price: '$0.35 / $0.75 per M',
    speed: 5,
    note: 'Fastest',
  },
  {
    key: 'gemma-4-31b-cerebras',
    kind: 'text',
    label: 'Gemma 4 31B',
    slug: 'google/gemma-4-31b-it',
    provider: 'openrouter',
    pinnedProvider: 'cerebras',
    lab: 'cerebras',
    price: '$0.99 / $1.49 per M',
    speed: 5,
  },
  {
    key: 'mistral-nemo',
    kind: 'text',
    label: 'Mistral Nemo',
    slug: 'mistralai/mistral-nemo',
    provider: 'openrouter',
    lab: 'mistral',
    price: '$0.02 / $0.03 per M',
    note: 'Cheapest',
  },
  {
    key: 'qwen3-flash',
    kind: 'text',
    label: 'Qwen3.7 Flash',
    slug: 'qwen/qwen3.7-flash',
    provider: 'openrouter',
    lab: 'qwen',
    price: '$0.03 / $0.13 per M',
  },
  {
    key: 'glm-4-7-flash',
    kind: 'text',
    label: 'GLM 4.7 Flash',
    slug: 'z-ai/glm-4.7-flash',
    provider: 'openrouter',
    lab: 'zai',
    price: '$0.06 / $0.40 per M',
  },
  {
    key: 'gpt-5-6-luna',
    kind: 'text',
    label: 'GPT-5.6 Luna',
    slug: 'openai/gpt-5.6-luna',
    provider: 'openrouter',
    lab: 'openai',
    price: '$0.10 / $0.60 per M',
  },
  {
    key: 'gemini-2-5-flash-lite',
    kind: 'text',
    label: 'Gemini 2.5 Flash Lite',
    slug: 'google/gemini-2.5-flash-lite',
    provider: 'openrouter',
    lab: 'google',
    price: '$0.10 / $0.40 per M',
  },
  {
    key: 'gpt-5-4-nano',
    kind: 'text',
    label: 'GPT-5.4 Nano',
    slug: 'openai/gpt-5.4-nano',
    provider: 'openrouter',
    lab: 'openai',
    price: '$0.20 / $1.25 per M',
  },
  {
    key: 'gemini-3-5-flash-lite',
    kind: 'text',
    label: 'Gemini 3.5 Flash Lite',
    slug: 'google/gemini-3.5-flash-lite',
    provider: 'openrouter',
    lab: 'google',
    price: '$0.30 / $2.50 per M',
  },
  {
    key: 'gemini-3-7-flash',
    kind: 'text',
    label: 'Gemini 3.7 Flash',
    slug: 'google/gemini-3.7-flash',
    provider: 'openrouter',
    lab: 'google',
    price: '$0.38 / $1.88 per M',
  },
  {
    key: 'claude-haiku-4-5',
    kind: 'text',
    label: 'Claude Haiku 4.5',
    slug: 'anthropic/claude-haiku-4.5',
    provider: 'openrouter',
    lab: 'anthropic',
    price: '$1 / $5 per M',
  },
  {
    key: 'claude-sonnet-5',
    kind: 'text',
    label: 'Claude Sonnet 5',
    slug: 'anthropic/claude-sonnet-5',
    provider: 'openrouter',
    lab: 'anthropic',
    price: '$2 / $10 per M',
  },
]

export const CATALOG: CatalogModel[] = [...VOICE_MODELS, ...TEXT_MODELS]

const BY_KEY = new Map(CATALOG.map(model => [model.key, model]))

export const DEFAULT_SHORT_VOICE_KEY = 'whisper-large-v3'
export const DEFAULT_LONG_VOICE_KEY = 'gpt-transcribe'
export const DEFAULT_TEXT_KEY = 'gpt-oss-20b-groq'

export function findModel(key: string | undefined): CatalogModel | undefined {
  return key ? BY_KEY.get(key) : undefined
}

/**
 * Resolve a stored key, falling back to the default when it names a model that
 * left the catalogue. Callers never have to handle `undefined`.
 */
export function resolveModel(
  key: string | undefined,
  fallbackKey: string,
): CatalogModel {
  return findModel(key) ?? BY_KEY.get(fallbackKey)!
}

/**
 * Reverse lookup, used once: translating settings that stored raw model slugs
 * into catalogue keys. `provider` disambiguates the models we list twice, such
 * as gpt-oss-120b served both by Groq directly and by Cerebras via OpenRouter.
 */
export function findModelBySlug(
  kind: ModelKind,
  slug: string | undefined,
  provider?: CatalogProvider,
): CatalogModel | undefined {
  if (!slug) return undefined
  return CATALOG.find(
    model =>
      model.kind === kind &&
      model.slug === slug &&
      (provider === undefined || model.provider === provider),
  )
}

/** Short-dictation transcription always runs on Groq. */
export const SHORT_VOICE_MODELS = VOICE_MODELS.filter(
  model => model.provider === 'groq',
)

/** Long-dictation transcription always runs on OpenRouter. */
export const LONG_VOICE_MODELS = VOICE_MODELS.filter(
  model => model.provider === 'openrouter',
)
