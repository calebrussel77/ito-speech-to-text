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

function createTranscriptionPrompt(vocabulary: string[]): string {
  const suffix = ''
  const maxTokens = 224

  if (vocabulary.length === 0) {
    return suffix
  }

  const basePrompt = 'Dictionary entries include: '
  const estimateTokens = (text: string) => Math.ceil(text.length / 4)
  const baseTokens = estimateTokens(basePrompt + '. ' + suffix)
  const availableTokensForVocab = maxTokens - baseTokens

  let vocabString = vocabulary.join(', ')
  if (estimateTokens(vocabString) > availableTokensForVocab) {
    const maxVocabLength = availableTokensForVocab * 4 - 10
    vocabString = vocabString
      .substring(0, maxVocabLength)
      .replace(/,\s*[^,]*$/, '')
  }

  if (vocabString.trim() === '') {
    return suffix
  }

  return `${basePrompt}${vocabString}. ${suffix}`
}

class LocalTranscriptionError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'MISSING_API_KEY'
      | 'INVALID_API_KEY'
      | 'NO_SPEECH'
      | 'AUDIO_TOO_SHORT'
      | 'NETWORK'
      | 'MODEL_ERROR'
      | 'UNKNOWN',
  ) {
    super(message)
    this.name = 'LocalTranscriptionError'
  }
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

    const prompt = createTranscriptionPrompt(options.vocabulary || [])
    const fileType = options.fileType || 'wav'
    const noSpeechThreshold =
      options.noSpeechThreshold ?? DEFAULT_NO_SPEECH_THRESHOLD

    try {
      const file = await toFile(audioBuffer, `audio.${fileType}`)
      const transcription = await client.audio.transcriptions.create({
        file,
        model: effectiveModel,
        prompt,
        response_format: 'verbose_json',
      })

      const segments = (transcription as any)?.segments || []
      const firstSegment = segments[0]
      if (firstSegment?.no_speech_prob > noSpeechThreshold) {
        throw new LocalTranscriptionError(
          'No speech detected in audio',
          'NO_SPEECH',
        )
      }

      return (transcription as any)?.text?.trim?.() || ''
    } catch (error: any) {
      if (error instanceof LocalTranscriptionError) throw error

      const message = error?.message || 'Failed to transcribe audio'
      if (message.includes('401')) {
        throw new LocalTranscriptionError(
          'Groq rejected the API key',
          'INVALID_API_KEY',
        )
      }
      if (message.toLowerCase().includes('short')) {
        throw new LocalTranscriptionError(
          'Audio file is too short',
          'AUDIO_TOO_SHORT',
        )
      }
      if (message.toLowerCase().includes('rate limit')) {
        throw new LocalTranscriptionError(
          'Groq rate limit hit, please retry shortly',
          'NETWORK',
        )
      }
      throw new LocalTranscriptionError(message, 'UNKNOWN')
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
