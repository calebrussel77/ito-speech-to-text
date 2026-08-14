import { ItoMode } from '@/app/generated/ito_pb'
import { Notification } from 'electron'
import log from 'electron-log'
import { AudioStreamManager } from './audio/AudioStreamManager'
import { localAudioProcessor } from './transcription/LocalAudioProcessor'
import {
  localTranscriptionService,
  LocalTranscriptionError,
  TranscriptionOptions,
} from './transcription/LocalTranscriptionService'
import {
  UNRECOVERABLE_CODES,
  LONG_DICTATION_THRESHOLD_MS,
} from '../constants/transcription'
import {
  DEFAULT_LONG_VOICE_KEY,
  DEFAULT_SHORT_VOICE_KEY,
  resolveModel,
} from '../constants/modelCatalog'
import { openRouterTranscriptionService } from './transcription/OpenRouterTranscriptionService'
import {
  clearOpenRouterFailure,
  failureNotice,
  getRejectedKeyFailure,
  recordOpenRouterFailure,
} from './transcription/openRouterHealth'
import { transcriptAdjuster } from './transcription/TranscriptAdjuster'
import { pendingDictationStore } from './transcription/PendingDictationStore'
import { applyDictionaryCorrections } from './transcription/DictionaryCorrector'
import { interactionManager } from './interactions/InteractionManager'
import { recordingStateNotifier } from './recordingStateNotifier'
import { contextGrabber } from './context/ContextGrabber'
import { getAdvancedSettings } from './store'
import { timingCollector, TimingEventName } from './timing/TimingCollector'

const RETRYABLE_CODES = new Set(['RATE_LIMIT', 'NETWORK'])

type RetryPolicy = {
  attempts: number
  /** A wait longer than this is not worth it: give up and let the caller move on. */
  maxDelayMs: number
}

const GROQ_RETRY: RetryPolicy = {
  attempts: 3,
  maxDelayMs: Number.POSITIVE_INFINITY,
}

// Each OpenRouter attempt re-uploads the whole dictation (~3.5 MB for 80s) and
// takes roughly as long as the recording itself, and Groq still has to run
// afterwards if it fails — so one extra try is all a waiting user can absorb.
// For the same reason a server-suggested delay of more than a second and a
// half is declined: falling back is faster than honouring it.
const OPENROUTER_RETRY: RetryPolicy = { attempts: 2, maxDelayMs: 1500 }

function showNotification(title: string, body: string) {
  try {
    if (Notification?.isSupported?.()) {
      new Notification({ title, body }).show()
    }
  } catch (error) {
    console.warn('[ItoStreamController] Failed to show notification:', error)
  }
}

/**
 * Why a dictation that should have gone to the precise engine came back from
 * Groq instead. Travels with the transcript so the history row can say it,
 * rather than leaving a downgrade indistinguishable from a normal dictation.
 */
export interface AsrFallback {
  /** Model slug that was skipped or that failed. */
  from: string
  code: string
  message: string
}

export interface LocalTranscriptionResult {
  transcript: string
  audioBuffer: Buffer
  sampleRate: number
  durationMs: number
  // Model that actually produced the transcript (e.g. 'whisper-large-v3',
  // 'openai/gpt-transcribe') — shown as a badge in the history.
  asrEngine: string
  asrFallback?: AsrFallback
}

/**
 * ItoStreamController now runs a fully local transcription pipeline.
 * It buffers audio, prepares a WAV, calls Groq directly, and returns the transcript.
 */
export class ItoStreamController {
  private audioStreamManager = new AudioStreamManager()
  private currentMode: ItoMode = ItoMode.TRANSCRIBE

  public async initialize(mode: ItoMode): Promise<boolean> {
    if (this.audioStreamManager.isCurrentlyStreaming()) {
      log.warn('[ItoStreamController] Stream already in progress.')
      return false
    }

    this.audioStreamManager.initialize()
    this.currentMode = mode
    console.log('[ItoStreamController] Starting new local interaction stream.')
    return true
  }

  public getCurrentMode(): ItoMode {
    return this.currentMode
  }

  public setMode(mode: ItoMode) {
    this.currentMode = mode
    console.log(`[ItoStreamController] Mode set to ${mode}`)
  }

  public endInteraction() {
    if (!this.audioStreamManager.isCurrentlyStreaming()) {
      log.warn('[ItoStreamController] No active stream to end')
      return
    }

    console.log('[ItoStreamController] Ending interaction stream')
    this.stopStreaming()
  }

  public cancelTranscription() {
    if (!this.audioStreamManager.isCurrentlyStreaming()) {
      log.warn('[ItoStreamController] No active stream to cancel')
      return
    }

    console.log('[ItoStreamController] Cancelling transcription')
    this.stopStreaming()
    this.audioStreamManager.clearInteractionAudio()
  }

  public getAudioDurationMs(): number {
    return this.audioStreamManager.getAudioDurationMs()
  }

  public getCurrentSampleRate(): number {
    return this.audioStreamManager.getCurrentSampleRate()
  }

  private stopStreaming() {
    this.audioStreamManager.stopStreaming()
  }

  public clearInteractionAudio() {
    this.audioStreamManager.clearInteractionAudio()
  }

  public getBufferedAudio(): Buffer {
    return this.audioStreamManager.getAllAudio()
  }

  // Backwards-compatible no-ops for legacy tests
  public async scheduleConfigUpdate(_context: any) {
    return
  }

  public async startGrpcStream() {
    return this.processLocalTranscription()
  }

  /**
   * Process the buffered audio through Groq and return the final transcript.
   * The WAV is persisted to disk before the network call and removed after
   * success, so a failure at any point never loses the dictation.
   */
  public async processLocalTranscription(): Promise<LocalTranscriptionResult> {
    const rawAudio = this.audioStreamManager.getAllAudio()
    const sampleRate = this.audioStreamManager.getCurrentSampleRate()

    const { wavAudio, durationMs } =
      localAudioProcessor.prepareAudioForTranscription(rawAudio, { sampleRate })

    let pendingPath: string | null = null
    try {
      pendingPath = pendingDictationStore.save(wavAudio)
    } catch (error) {
      console.warn(
        '[ItoStreamController] Could not persist dictation audio:',
        error,
      )
    }

    const context = await contextGrabber.gatherContext(this.currentMode)
    const advancedSettings = getAdvancedSettings()
    const timingEvent =
      this.currentMode === ItoMode.EDIT
        ? TimingEventName.LOCAL_EDIT
        : TimingEventName.LOCAL_TRANSCRIBE

    try {
      localTranscriptionService.initialize(advancedSettings.groqApiKey || '')
    } catch (error) {
      if (error instanceof LocalTranscriptionError) {
        throw error
      }
      throw new Error(
        error instanceof Error ? error.message : 'Groq API key missing',
      )
    }

    const shortModel = resolveModel(
      advancedSettings.shortVoiceModelKey,
      DEFAULT_SHORT_VOICE_KEY,
    )

    const groqOptions: TranscriptionOptions = {
      asrModel: shortModel.slug,
      vocabulary: context.vocabularyWords,
      noSpeechThreshold: advancedSettings.llm.noSpeechThreshold,
      fileType: 'wav',
      language: advancedSettings.llm.asrLanguage,
      customPrompt: advancedSettings.llm.asrPrompt,
    }

    let transcript: string
    // Groq is the default attribution; overwritten when OpenRouter answers.
    let asrEngine = shortModel.slug
    let asrFallback: AsrFallback | undefined
    try {
      transcript = await timingCollector.timeAsync(timingEvent, async () => {
        if (this.shouldUseOpenRouter(advancedSettings, durationMs)) {
          const apiKey = advancedSettings.openRouterApiKey || ''
          const openRouterModel = resolveModel(
            advancedSettings.longVoiceModelKey,
            DEFAULT_LONG_VOICE_KEY,
          ).slug
          const rejected = getRejectedKeyFailure(apiKey)

          if (rejected) {
            // This key already came back refused. Trying again would upload
            // the whole dictation for another certain 401, so go straight to
            // Groq — and still say so, rather than passing the downgrade off
            // as a normal dictation.
            console.warn(
              `[ItoStreamController] Skipping OpenRouter: the stored key was refused on ${rejected.at}`,
            )
            asrFallback = {
              from: openRouterModel,
              code: rejected.code,
              message: rejected.message,
            }
          } else {
            try {
              const text = await this.withRetry(
                `OpenRouter (${openRouterModel})`,
                OPENROUTER_RETRY,
                () =>
                  openRouterTranscriptionService.transcribeAudio(wavAudio, {
                    apiKey,
                    model: openRouterModel,
                    vocabulary: context.vocabularyWords,
                    language: advancedSettings.llm.asrLanguage,
                  }),
              )
              asrEngine = openRouterModel
              clearOpenRouterFailure()
              return text
            } catch (error: any) {
              // The precise engine must never lose or block a dictation:
              // whatever went wrong, the Groq path (and its retry/persistence
              // layer) takes over.
              asrFallback = this.recordOpenRouterFallback(
                error,
                openRouterModel,
                apiKey,
              )
            }
          }
        }
        return await this.withRetry('Groq', GROQ_RETRY, () =>
          localTranscriptionService.transcribeAudio(wavAudio, groqOptions),
        )
      })
    } catch (error: any) {
      if (pendingPath) {
        if (UNRECOVERABLE_CODES.has(error?.code)) {
          pendingDictationStore.delete(pendingPath)
        } else {
          showNotification(
            'Ito — dictée sauvegardée',
            'La transcription a échoué. Votre dictée sera récupérée automatiquement dans l’historique.',
          )
          // Let the session manager link the history row to this WAV, so the
          // later recovery updates that row instead of duplicating it.
          error.pendingDictationPath = pendingPath
        }
        this.notifyPendingCount()
      }
      error.audioDurationMs = durationMs
      throw error
    }

    // The dictionary is authoritative: fix near-miss spellings of user terms
    // that Whisper mangled (deterministic, local, no added latency).
    transcript = applyDictionaryCorrections(
      transcript,
      context.dictionaryEntries,
    )

    if (pendingPath) {
      pendingDictationStore.delete(pendingPath)
      this.notifyPendingCount()
    }
    // Network is clearly up: try to recover previously failed dictations.
    setTimeout(() => {
      this.flushPendingDictations().catch(error =>
        console.warn('[ItoStreamController] Pending flush failed:', error),
      )
    }, 5000)

    const adjusted = await transcriptAdjuster.adjust(
      transcript,
      this.currentMode,
      context,
      advancedSettings,
    )

    return {
      transcript: adjusted,
      audioBuffer: Buffer.alloc(0), // We intentionally avoid persisting audio
      sampleRate,
      durationMs,
      asrEngine,
      asrFallback,
    }
  }

  /**
   * Turns an OpenRouter failure into the three traces it deserves: a line in
   * the log, a notification that names the actual cause, and a record in the
   * settings that outlives both.
   */
  private recordOpenRouterFallback(
    error: any,
    model: string,
    apiKey: string,
  ): AsrFallback {
    const code = error?.code || 'UNKNOWN'
    const message = error?.message || 'OpenRouter request failed'

    console.warn(
      `[ItoStreamController] OpenRouter (${model}) failed (${code}), falling back to Groq:`,
      message,
    )
    recordOpenRouterFailure({ code, message, model, apiKey })
    showNotification('Ito — repli sur Groq', failureNotice(code))

    return { from: model, code, message }
  }

  // Recordings at or above the threshold go to the precise OpenRouter engine
  // when the long-dictation toggle is on. Without an OpenRouter key everything
  // stays on Groq.
  private shouldUseOpenRouter(
    advancedSettings: ReturnType<typeof getAdvancedSettings>,
    durationMs: number,
  ): boolean {
    if (advancedSettings.longDictationEnabled === false) return false

    const threshold =
      advancedSettings.longDictationThresholdMs ?? LONG_DICTATION_THRESHOLD_MS
    if (durationMs < threshold) return false

    if (!advancedSettings.openRouterApiKey?.trim()) {
      console.warn(
        '[ItoStreamController] Long dictation but no OpenRouter API key configured, using Groq',
      )
      return false
    }
    return true
  }

  /**
   * Retries a transcription call for the failures that are worth retrying —
   * a rate limit or a dropped connection — and gives up immediately on the
   * ones a second identical request cannot fix.
   */
  private async withRetry<T>(
    label: string,
    policy: RetryPolicy,
    run: () => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await run()
      } catch (error: any) {
        const delayMs = error?.retryAfterMs ?? 500 * 2 ** (attempt - 1)
        const retryable =
          error instanceof LocalTranscriptionError &&
          RETRYABLE_CODES.has(error.code) &&
          attempt < policy.attempts &&
          delayMs <= policy.maxDelayMs
        if (!retryable) throw error

        console.warn(
          `[ItoStreamController] ${label} attempt ${attempt} failed (${error.code}), retrying in ${delayMs}ms`,
        )
        await new Promise(resolve => setTimeout(resolve, delayMs))
      }
    }
  }

  private flushingPending = false

  // Keeps the dashboard's "pending dictations" banner in sync with the disk
  // queue whenever it changes.
  private notifyPendingCount() {
    try {
      recordingStateNotifier.notifyPendingDictations(
        pendingDictationStore.list().length,
      )
    } catch (error) {
      console.warn('[ItoStreamController] Pending count notify failed:', error)
    }
  }

  /**
   * Transcribes dictations that previously failed and stores them in the
   * interaction history (no text insertion: the original cursor context is
   * long gone). Called at startup and after each successful transcription.
   */
  public async flushPendingDictations(): Promise<number> {
    if (this.flushingPending) return 0
    this.flushingPending = true
    let recovered = 0

    try {
      const pending = pendingDictationStore.list()
      if (pending.length === 0) return 0

      const advancedSettings = getAdvancedSettings()
      try {
        localTranscriptionService.initialize(advancedSettings.groqApiKey || '')
      } catch {
        return 0
      }

      for (const filePath of pending) {
        // A live recording takes priority over recovery work.
        if (this.audioStreamManager.isCurrentlyStreaming()) break

        try {
          const wavAudio = pendingDictationStore.read(filePath)
          const transcript = await localTranscriptionService.transcribeAudio(
            wavAudio,
            {
              asrModel: advancedSettings.llm.asrModel,
              noSpeechThreshold: advancedSettings.llm.noSpeechThreshold,
              fileType: 'wav',
              language: advancedSettings.llm.asrLanguage,
              customPrompt: advancedSettings.llm.asrPrompt,
            },
          )
          if (transcript) {
            await interactionManager.createRecoveredInteraction(
              transcript,
              16000,
              filePath,
              undefined,
              advancedSettings.llm.asrModel,
            )
            recovered++
          }
          pendingDictationStore.delete(filePath)
        } catch (error: any) {
          if (UNRECOVERABLE_CODES.has(error?.code)) {
            pendingDictationStore.delete(filePath)
            continue
          }
          // Still failing (offline, rate limit...): stop and retry later.
          break
        }
      }

      if (recovered > 0) {
        showNotification(
          'Ito — dictées récupérées',
          `${recovered} dictée(s) transcrite(s) et disponible(s) dans l'historique.`,
        )
      }
      return recovered
    } finally {
      this.flushingPending = false
      this.notifyPendingCount()
    }
  }
}

export const itoStreamController = new ItoStreamController()
