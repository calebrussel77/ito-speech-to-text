import Groq from 'groq-sdk'
import { toFile } from 'groq-sdk/uploads'
import { ItoMode } from '@/app/generated/ito_pb'
import { AdvancedSettings } from '../store'
import { ContextData } from '../context/ContextGrabber'

export type TranscriptionOptions = {
  asrModel?: string
  vocabulary?: string[]
  noSpeechThreshold?: number
  fileType?: string
  // ISO-639-1 hint forwarded to Whisper; empty/undefined = auto-detect
  language?: string
  // User-provided ASR prompt from Advanced Settings; vocabulary is appended
  customPrompt?: string
}

export type AdjustOptions = {
  model?: string
  temperature?: number
  prompt?: string
}

type ApiTestResult = { ok: boolean; message?: string }

const DEFAULT_NO_SPEECH_THRESHOLD = 0.6
const DEFAULT_LLM_MODEL = 'llama-3.1-8b-instant'
const DECOMMISSIONED_MODELS: Record<string, string> = {
  'llama3-8b-8192': DEFAULT_LLM_MODEL,
  'llama3-8b-instruct': DEFAULT_LLM_MODEL,
}

const normalizeModel = (model?: string) =>
  model && DECOMMISSIONED_MODELS[model] ? DECOMMISSIONED_MODELS[model] : model

// Whisper's prompt is style/context priming, not instructions: the model
// mimics its language, punctuation and casing. A French, punctuated base
// prompt pulls the output toward well-punctuated French; the user dictionary
// rides along as vocabulary priming.
const DEFAULT_PROMPT_BASE = `Voici une dictée en français, correctement ponctuée et accentuée, qui peut mêler des termes techniques anglais du développement logiciel.`

export function createTranscriptionPrompt(
  vocabulary: string[],
  customPrompt?: string,
): string {
  const maxTokens = 224
  const basePrompt = customPrompt?.trim() || DEFAULT_PROMPT_BASE

  const estimateTokens = (text: string) => Math.ceil(text.length / 4)

  if (vocabulary.length === 0) {
    return basePrompt
  }

  const vocabPrefix = ' Vocabulaire : '
  const availableTokensForVocab =
    maxTokens - estimateTokens(basePrompt + vocabPrefix + '.')

  if (availableTokensForVocab <= 0) {
    return basePrompt
  }

  let vocabString = vocabulary.join(', ')
  if (estimateTokens(vocabString) > availableTokensForVocab) {
    const maxVocabLength = availableTokensForVocab * 4 - 10
    vocabString = vocabString
      .substring(0, maxVocabLength)
      .replace(/,\s*[^,]*$/, '')
  }

  if (vocabString.trim() === '') {
    return basePrompt
  }

  return `${basePrompt}${vocabPrefix}${vocabString}.`
}

type TranscriptionSegment = {
  text?: string
  no_speech_prob?: number
  avg_logprob?: number
  compression_ratio?: number
}

// A segment is considered hallucinated when Whisper itself reports it is
// probably not speech AND has low confidence in the tokens it produced
// (classic silence hallucinations like "Sous-titres réalisés par Amara.org").
const HALLUCINATION_AVG_LOGPROB = -0.5

export function filterSpeechSegments(
  segments: TranscriptionSegment[],
  noSpeechThreshold: number,
): { text: string | null; allNoSpeech: boolean } {
  if (segments.length === 0) {
    return { text: null, allNoSpeech: false }
  }

  const isNoSpeech = (s: TranscriptionSegment) =>
    (s.no_speech_prob ?? 0) > noSpeechThreshold

  if (segments.every(isNoSpeech)) {
    return { text: null, allNoSpeech: true }
  }

  const kept = segments.filter(
    s =>
      !(isNoSpeech(s) && (s.avg_logprob ?? 0) < HALLUCINATION_AVG_LOGPROB),
  )

  return {
    text: kept
      .map(s => s.text || '')
      .join('')
      .trim(),
    allNoSpeech: false,
  }
}

class LocalTranscriptionError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'MISSING_API_KEY'
      | 'INVALID_API_KEY'
      | 'NO_SPEECH'
      | 'AUDIO_TOO_SHORT'
      | 'RATE_LIMIT'
      | 'NETWORK'
      | 'MODEL_ERROR'
      | 'UNKNOWN',
    // HTTP status and server-suggested retry delay, when the Groq SDK
    // provides them — consumed by the retry layer.
    public readonly status?: number,
    public readonly retryAfterMs?: number,
  ) {
    super(message)
    this.name = 'LocalTranscriptionError'
  }
}

// Map a Groq SDK error to a typed LocalTranscriptionError using the HTTP
// status when available, falling back to message sniffing for older shapes.
function mapGroqError(
  error: any,
  fallbackMessage: string,
): LocalTranscriptionError {
  const message: string = error?.message || fallbackMessage
  const status: number | undefined =
    typeof error?.status === 'number' ? error.status : undefined
  const retryAfterHeader = error?.headers?.['retry-after']
  const retryAfterMs = retryAfterHeader
    ? Number(retryAfterHeader) * 1000 || undefined
    : undefined

  if (status === 401 || status === 403 || message.includes('401')) {
    return new LocalTranscriptionError(
      'Groq rejected the API key',
      'INVALID_API_KEY',
      status,
    )
  }
  if (status === 429 || message.toLowerCase().includes('rate limit')) {
    return new LocalTranscriptionError(
      'Groq rate limit hit, please retry shortly',
      'RATE_LIMIT',
      status,
      retryAfterMs,
    )
  }
  if (status === 400 && message.toLowerCase().includes('short')) {
    return new LocalTranscriptionError(
      'Audio file is too short',
      'AUDIO_TOO_SHORT',
      status,
    )
  }
  if (message.toLowerCase().includes('short')) {
    return new LocalTranscriptionError(
      'Audio file is too short',
      'AUDIO_TOO_SHORT',
      status,
    )
  }
  if (
    (status !== undefined && status >= 500) ||
    error?.name === 'APIConnectionError' ||
    error?.name === 'APIConnectionTimeoutError'
  ) {
    return new LocalTranscriptionError(message, 'NETWORK', status, retryAfterMs)
  }
  return new LocalTranscriptionError(message, 'UNKNOWN', status)
}

class LocalTranscriptionService {
  private groqClient: Groq | null = null
  private currentApiKey: string | null = null

  initialize(apiKey: string): void {
    if (!apiKey) {
      throw new LocalTranscriptionError(
        'Groq API key is required',
        'MISSING_API_KEY',
      )
    }

    if (!apiKey.startsWith('gsk_')) {
      throw new LocalTranscriptionError(
        'Groq API key must start with "gsk_"',
        'INVALID_API_KEY',
      )
    }

    // Reuse the existing client when the key has not changed
    if (this.currentApiKey === apiKey && this.groqClient) {
      return
    }

    this.currentApiKey = apiKey
    this.groqClient = new Groq({ apiKey })
  }

  isAvailable(): boolean {
    return !!this.groqClient
  }

  private ensureClient() {
    if (!this.groqClient) {
      throw new LocalTranscriptionError(
        'Groq client not initialized',
        'MISSING_API_KEY',
      )
    }
    return this.groqClient
  }

  async transcribeAudio(
    audioBuffer: Buffer,
    options: TranscriptionOptions,
  ): Promise<string> {
    const client = this.ensureClient()

    const asrModel = options.asrModel
    if (!asrModel) {
      throw new LocalTranscriptionError(
        'ASR model is required',
        'MODEL_ERROR',
      )
    }
    const effectiveModel = normalizeModel(asrModel) || asrModel

    const prompt = createTranscriptionPrompt(
      options.vocabulary || [],
      options.customPrompt,
    )
    const fileType = options.fileType || 'wav'
    const noSpeechThreshold =
      options.noSpeechThreshold ?? DEFAULT_NO_SPEECH_THRESHOLD
    const language = options.language?.trim()

    try {
      const file = await toFile(audioBuffer, `audio.${fileType}`)
      const transcription = await client.audio.transcriptions.create({
        file,
        model: effectiveModel,
        prompt,
        response_format: 'verbose_json',
        temperature: 0,
        ...(language ? { language } : {}),
      })

      const segments: TranscriptionSegment[] =
        (transcription as any)?.segments || []
      const { text: filteredText, allNoSpeech } = filterSpeechSegments(
        segments,
        noSpeechThreshold,
      )
      if (allNoSpeech) {
        throw new LocalTranscriptionError(
          'No speech detected in audio',
          'NO_SPEECH',
        )
      }

      if (filteredText !== null) {
        return filteredText
      }
      return (transcription as any)?.text?.trim?.() || ''
    } catch (error: any) {
      if (error instanceof LocalTranscriptionError) throw error
      throw mapGroqError(error, 'Failed to transcribe audio')
    }
  }

  async adjustTranscript(
    transcript: string,
    mode: ItoMode,
    context: ContextData,
    advancedSettings: AdvancedSettings,
  ): Promise<string> {
    if (!transcript) return ''

    // In TRANSCRIBE mode we want raw (or lightly trimmed) output only.
    if (mode === ItoMode.TRANSCRIBE) {
      return transcript.trim()
    }

    const client = this.ensureClient()
    const model =
      normalizeModel(advancedSettings?.llm?.llmModel) ||
      normalizeModel(advancedSettings?.llm?.asrModel) ||
      DEFAULT_LLM_MODEL

    const temperature = advancedSettings?.llm?.llmTemperature ?? 0.7
    const editingPrompt =
      advancedSettings?.llm?.editingPrompt ||
      'Polish the transcript for clarity and grammar without changing intent.'

    const modePrompt =
      mode === ItoMode.EDIT
        ? `You are in EDIT mode. Use the provided context (window title, app name, and selected text) to adjust the transcript. Keep the user's intent and be concise.`
        : 'You are in TRANSCRIBE mode. Lightly clean the transcript for casing and spacing while preserving words.'

    const contextSummary = [
      context.windowTitle && `Window: ${context.windowTitle}`,
      context.appName && `App: ${context.appName}`,
      context.contextText && `Selected: ${context.contextText}`,
    ]
      .filter(Boolean)
      .join(' | ')

    const userContent = `Transcript:\n${transcript}\n\nContext:\n${contextSummary || 'None'}`

    try {
      const result = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: `${modePrompt}\n${editingPrompt}` },
          { role: 'user', content: userContent },
        ],
        temperature,
        max_tokens: transcript.length + 64 > 2048 ? 2048 : undefined,
      })

      const choice = (result as any)?.choices?.[0]?.message?.content
      return choice?.trim?.() || transcript
    } catch (error: any) {
      const message = error?.message || 'Failed to adjust transcript'
      console.error('[LocalTranscriptionService] adjustTranscript failed:', message)
      return transcript
    }
  }

  async testConnection(apiKey: string): Promise<ApiTestResult> {
    try {
      this.initialize(apiKey)
      const client = this.ensureClient()
      const result = await client.chat.completions.create({
        model: DEFAULT_LLM_MODEL,
        messages: [{ role: 'system', content: 'ping' }],
        max_tokens: 1,
        temperature: 0,
      })

      const ok = !!(result as any)?.choices?.length
      return { ok, message: ok ? 'Connected to Groq' : 'Unexpected response' }
    } catch (error: any) {
      const message = error?.message || 'Unable to reach Groq'
      if (message.includes('401')) {
        return { ok: false, message: 'Invalid Groq API key' }
      }
      return { ok: false, message }
    }
  }
}

export const localTranscriptionService = new LocalTranscriptionService()
export { LocalTranscriptionError }
