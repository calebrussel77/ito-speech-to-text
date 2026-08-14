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
   * Human-readable price, already carrying its unit — $/h for voice so the
   * column compares, $/M in/out for text.
   *
   * Voice figures are measured, not read off OpenRouter's `pricing` field:
   * that field mixes $/second, $/minute and $/token between providers, so the
   * numbers there are not comparable. These come from the `usage.cost` each
   * request returns, sampled at 2s and 10s per model; the two agreed exactly,
   * which also rules out a per-request minimum (Groq bills one, OpenRouter
   * does not). `null` means the provider publishes nothing and we have not
   * measured it.
   */
  price: string | null
  /**
   * 1-5 gauges, both measured end to end on 2026-08-14 — no vendor figure is
   * used, because published numbers describe short English benchmarks and
   * disagreed sharply with what these models do on real French dictation.
   *
   * Voice: run against the two bake-off recordings (79s and 149s of Caleb's
   * own dictation, .wayfinder/assets/015-bakeoff/), as 16 kHz mono WAV — the
   * exact payload the app sends. `speed` is the real-time factor (seconds of
   * audio per second of wall clock, network included); `accuracy` is the word
   * error rate against the transcript Caleb ranked first blind on both clips.
   *
   * Text: median tokens/second over 3 runs of the app's real Intelligent Mode
   * prompt on a real transcript. Includes network round trip, so these are
   * end-to-end figures rather than the peak throughput vendors advertise.
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
    key: 'whisper-large-v3-turbo',
    kind: 'voice',
    label: 'Whisper Large v3 Turbo',
    slug: 'whisper-large-v3-turbo',
    provider: 'groq',
    lab: 'openai',
    price: '$0.04 / h',
    speed: 5,
    accuracy: 4,
    note: 'Default - fastest, and the only reliable Groq option',
  },
  {
    key: 'whisper-large-v3',
    kind: 'voice',
    label: 'Whisper Large v3',
    slug: 'whisper-large-v3',
    provider: 'groq',
    lab: 'openai',
    price: '$0.111 / h',
    speed: 4,
    accuracy: 1,
    note: 'Loops and invents past ~40s - kept for comparison only',
  },
  {
    key: 'gpt-transcribe',
    kind: 'voice',
    label: 'GPT Transcribe',
    slug: 'openai/gpt-transcribe',
    provider: 'openrouter',
    lab: 'openai',
    price: '$0.27 / h',
    speed: 2,
    accuracy: 5,
    note: 'Most accurate',
    proven: true,
  },
  {
    key: 'qwen3-asr-flash',
    kind: 'voice',
    label: 'Qwen3 ASR Flash',
    slug: 'qwen/qwen3-asr-flash-2026-02-10',
    provider: 'openrouter',
    lab: 'qwen',
    price: '$0.13 / h',
    speed: 2,
    accuracy: 5,
    note: 'Best value - near the top at half the price',
  },
  {
    key: 'gpt-4o-transcribe',
    kind: 'voice',
    label: 'GPT-4o Transcribe',
    slug: 'openai/gpt-4o-transcribe',
    provider: 'openrouter',
    lab: 'openai',
    price: '$0.12 / h',
    speed: 2,
    accuracy: 4,
  },
  {
    key: 'voxtral-small-stt',
    kind: 'voice',
    label: 'Voxtral Small 24B STT',
    slug: 'mistralai/voxtral-small-24b-2507-stt',
    provider: 'openrouter',
    lab: 'mistral',
    price: '$0.18 / h',
    speed: 2,
    accuracy: 4,
  },
  {
    key: 'voxtral-mini-transcribe',
    kind: 'voice',
    label: 'Voxtral Mini Transcribe',
    slug: 'mistralai/voxtral-mini-transcribe',
    provider: 'openrouter',
    lab: 'mistral',
    price: '$0.18 / h',
    speed: 3,
    accuracy: 3,
    note: 'Quickest of the long-form engines',
    proven: true,
  },
  {
    key: 'whisper-large-v3-turbo-openrouter',
    kind: 'voice',
    label: 'Whisper Large v3 Turbo',
    slug: 'openai/whisper-large-v3-turbo',
    provider: 'openrouter',
    lab: 'openai',
    price: '$0.012 / h',
    speed: 2,
    accuracy: 2,
    note: 'Cheapest by far, but weaker than the same model on Groq',
  },
  {
    key: 'nova-3',
    kind: 'voice',
    label: 'Nova 3',
    slug: 'deepgram/nova-3',
    provider: 'openrouter',
    lab: 'deepgram',
    price: '$0.26 / h',
    speed: 2,
    accuracy: 2,
  },
]

// Measured tokens/second, median of 3 runs (2026-08-14):
// gpt-oss-120b@Cerebras 1704, qwen3.7-flash 862, glm-4.7-flash 584,
// qwen3.6-27b 392, gpt-5.6-luna 363, gpt-oss-120b@Groq 348, gpt-5.4-nano 344,
// gpt-oss-20b@Groq 309, gemma-4-31b@Cerebras 165, claude-sonnet-5 145,
// gemini-3.7-flash 118, mistral-nemo 99, gemini-3.5-flash-lite 66,
// claude-haiku-4.5 60, gemini-2.5-flash-lite 20.
export const TEXT_MODELS: CatalogModel[] = [
  {
    key: 'gpt-oss-20b-groq',
    kind: 'text',
    label: 'GPT-OSS 20B',
    slug: 'openai/gpt-oss-20b',
    provider: 'groq',
    lab: 'openai',
    price: '$0.075 / $0.30 per M',
    speed: 3,
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
    price: '$0.60 / $3.00 per M',
    speed: 4,
    // Groq lists this one under Preview, which its own policy defines as
    // evaluation-only and removable at short notice.
    note: 'Preview at Groq — may disappear without warning',
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
    note: 'Fastest - 5x the same model on Groq',
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
    speed: 3,
  },
  {
    key: 'qwen3-flash',
    kind: 'text',
    label: 'Qwen3.7 Flash',
    slug: 'qwen/qwen3.7-flash',
    provider: 'openrouter',
    lab: 'qwen',
    price: '$0.03 / $0.13 per M',
    speed: 5,
  },
  {
    key: 'glm-4-7-flash',
    kind: 'text',
    label: 'GLM 4.7 Flash',
    slug: 'z-ai/glm-4.7-flash',
    provider: 'openrouter',
    lab: 'zai',
    price: '$0.06 / $0.40 per M',
    speed: 4,
  },
  {
    key: 'gpt-5-6-luna',
    kind: 'text',
    label: 'GPT-5.6 Luna',
    slug: 'openai/gpt-5.6-luna',
    provider: 'openrouter',
    lab: 'openai',
    price: '$0.10 / $0.60 per M',
    speed: 4,
  },
  {
    key: 'gpt-5-4-nano',
    kind: 'text',
    label: 'GPT-5.4 Nano',
    slug: 'openai/gpt-5.4-nano',
    provider: 'openrouter',
    lab: 'openai',
    price: '$0.20 / $1.25 per M',
    speed: 3,
  },
  {
    key: 'mistral-nemo',
    kind: 'text',
    label: 'Mistral Nemo',
    slug: 'mistralai/mistral-nemo',
    provider: 'openrouter',
    lab: 'mistral',
    price: '$0.02 / $0.03 per M',
    speed: 2,
    note: 'Cheapest',
  },
  {
    key: 'claude-sonnet-5',
    kind: 'text',
    label: 'Claude Sonnet 5',
    slug: 'anthropic/claude-sonnet-5',
    provider: 'openrouter',
    lab: 'anthropic',
    price: '$2 / $10 per M',
    speed: 2,
  },
  {
    key: 'gemini-3-7-flash',
    kind: 'text',
    label: 'Gemini 3.7 Flash',
    slug: 'google/gemini-3.7-flash',
    provider: 'openrouter',
    lab: 'google',
    price: '$0.38 / $1.88 per M',
    speed: 2,
  },
  {
    key: 'gemini-3-5-flash-lite',
    kind: 'text',
    label: 'Gemini 3.5 Flash Lite',
    slug: 'google/gemini-3.5-flash-lite',
    provider: 'openrouter',
    lab: 'google',
    price: '$0.30 / $2.50 per M',
    speed: 2,
  },
  {
    key: 'claude-haiku-4-5',
    kind: 'text',
    label: 'Claude Haiku 4.5',
    slug: 'anthropic/claude-haiku-4.5',
    provider: 'openrouter',
    lab: 'anthropic',
    price: '$1 / $5 per M',
    speed: 2,
  },
  {
    key: 'gemini-2-5-flash-lite',
    kind: 'text',
    label: 'Gemini 2.5 Flash Lite',
    slug: 'google/gemini-2.5-flash-lite',
    provider: 'openrouter',
    lab: 'google',
    price: '$0.10 / $0.40 per M',
    speed: 1,
    note: 'Slowest measured - 20 tok/s',
  },
]

export const CATALOG: CatalogModel[] = [...VOICE_MODELS, ...TEXT_MODELS]

const BY_KEY = new Map(CATALOG.map(model => [model.key, model]))

export const DEFAULT_SHORT_VOICE_KEY = 'whisper-large-v3-turbo'
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
