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
import { pendingDictationStore } from './transcription/PendingDictationStore'
import { applyDictionaryCorrections } from './transcription/DictionaryCorrector'
import { interactionManager } from './interactions/InteractionManager'
import { contextGrabber } from './context/ContextGrabber'
import { getAdvancedSettings } from './store'
import { timingCollector, TimingEventName } from './timing/TimingCollector'

const RETRYABLE_CODES = new Set(['RATE_LIMIT', 'NETWORK'])
// Codes for which keeping the audio makes no sense (there is nothing to
// recover from silence or sub-100ms clips).
const UNRECOVERABLE_CODES = new Set(['NO_SPEECH', 'AUDIO_TOO_SHORT'])
const MAX_TRANSCRIPTION_ATTEMPTS = 3

function showNotification(title: string, body: string) {
  try {
    if (Notification?.isSupported?.()) {
      new Notification({ title, body }).show()
    }
  } catch (error) {
    console.warn('[ItoStreamController] Failed to show notification:', error)
  }
}

export interface LocalTranscriptionResult {
  transcript: string
  audioBuffer: Buffer
  sampleRate: number
  durationMs: number
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

    const { wavAudio, durationMs } = localAudioProcessor.prepareAudioForTranscription(
      rawAudio,
      { sampleRate },
    )

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

    let transcript: string
    try {
      transcript = await timingCollector.timeAsync(
        timingEvent,
        async () =>
          await this.transcribeWithRetry(wavAudio, {
            asrModel: advancedSettings.llm.asrModel,
            vocabulary: context.vocabularyWords,
            noSpeechThreshold: advancedSettings.llm.noSpeechThreshold,
            fileType: 'wav',
            language: advancedSettings.llm.asrLanguage,
            customPrompt: advancedSettings.llm.asrPrompt,
          }),
      )
    } catch (error: any) {
      if (pendingPath) {
        if (UNRECOVERABLE_CODES.has(error?.code)) {
          pendingDictationStore.delete(pendingPath)
        } else {
          showNotification(
            'Ito — dictée sauvegardée',
            'La transcription a échoué. Votre dictée sera récupérée automatiquement dans l’historique.',
          )
        }
      }
      throw error
    }

    // The dictionary is authoritative: fix near-miss spellings of user terms
    // that Whisper mangled (deterministic, local, no added latency).
    transcript = applyDictionaryCorrections(transcript, context.vocabularyWords)

    if (pendingPath) {
      pendingDictationStore.delete(pendingPath)
    }
    // Network is clearly up: try to recover previously failed dictations.
    setTimeout(() => {
      this.flushPendingDictations().catch(error =>
        console.warn('[ItoStreamController] Pending flush failed:', error),
      )
    }, 5000)

    const adjusted = await localTranscriptionService.adjustTranscript(
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
    }
  }

  private async transcribeWithRetry(
    wavAudio: Buffer,
    options: TranscriptionOptions,
  ): Promise<string> {
    let lastError: unknown
    for (let attempt = 1; attempt <= MAX_TRANSCRIPTION_ATTEMPTS; attempt++) {
      try {
        return await localTranscriptionService.transcribeAudio(
          wavAudio,
          options,
        )
      } catch (error: any) {
        lastError = error
        const retryable =
          error instanceof LocalTranscriptionError &&
          RETRYABLE_CODES.has(error.code)
        if (!retryable || attempt === MAX_TRANSCRIPTION_ATTEMPTS) {
          throw error
        }
        const delayMs = error.retryAfterMs ?? 500 * 2 ** (attempt - 1)
        console.warn(
          `[ItoStreamController] Transcription attempt ${attempt} failed (${error.code}), retrying in ${delayMs}ms`,
        )
        await new Promise(resolve => setTimeout(resolve, delayMs))
      }
    }
    throw lastError
  }

  private flushingPending = false

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
    }
  }
}

export const itoStreamController = new ItoStreamController()
