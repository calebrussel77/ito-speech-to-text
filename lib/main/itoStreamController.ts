import { Notification } from 'electron'
import log from 'electron-log'
import { AudioStreamManager } from './audio/AudioStreamManager'
import { localAudioProcessor } from './transcription/LocalAudioProcessor'
import {
  localTranscriptionService,
  LocalTranscriptionError,
  TranscriptionOptions,
} from './transcription/LocalTranscriptionService'
import { UNRECOVERABLE_CODES } from '../constants/transcription'
import {
  DEFAULT_SHORT_VOICE_KEY,
  resolveModel,
} from '../constants/modelCatalog'
import { asrLanguageHint } from '../constants/modeLanguages'
import type { Mode } from './sqlite/models'
import { resolveActiveMode } from './modes/activeMode'
import { openRouterTranscriptionService } from './transcription/OpenRouterTranscriptionService'
import {
  deepgramTranscriptionService,
  type SpeakerSegment,
} from './transcription/DeepgramTranscriptionService'
import { chooseTranscriptionPath } from './transcription/transcriptionRouter'
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
  /**
   * Segments de locuteurs rendus par Deepgram quand le mode demande la
   * diarisation. Tableau vide sur les deux autres chemins, qui ne la
   * fournissent pas.
   */
  speakerSegments: SpeakerSegment[]
  /** Le mode qui a produit ce transcript, figé pour l'historique. */
  modeId: string
  modeName: string
  /**
   * Ce que le moteur vocal a réellement rendu, après correction du
   * dictionnaire mais avant toute réécriture par le mode. Moitié gauche
   * d'une paire d'exemple, et onglet « Original » de l'historique.
   */
  rawTranscript: string
}

/**
 * ItoStreamController now runs a fully local transcription pipeline.
 * It buffers audio, prepares a WAV, calls Groq directly, and returns the transcript.
 */
export class ItoStreamController {
  private audioStreamManager = new AudioStreamManager()
  private currentMode: Mode | null = null

  public async initialize(mode: Mode): Promise<boolean> {
    if (this.audioStreamManager.isCurrentlyStreaming()) {
      log.warn('[ItoStreamController] Stream already in progress.')
      return false
    }

    this.audioStreamManager.initialize()
    this.currentMode = mode
    console.log(
      `[ItoStreamController] Starting new interaction stream in mode "${mode.name}"`,
    )
    return true
  }

  public getCurrentMode(): Mode | null {
    return this.currentMode
  }

  public setMode(mode: Mode) {
    this.currentMode = mode
    console.log(`[ItoStreamController] Mode set to "${mode.name}"`)
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

    const mode = this.currentMode
    if (!mode) throw new Error('No mode set on the stream controller')

    const context = await contextGrabber.gatherContext(mode)
    const advancedSettings = getAdvancedSettings()
    const timingEvent = mode.useLlm
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

    const voiceModel = resolveModel(
      mode.voiceModelKey ?? undefined,
      DEFAULT_SHORT_VOICE_KEY,
    )
    const languageHint = asrLanguageHint(mode.language)
    // Le repli Groq garde un modèle Groq : le slug d'un modèle OpenRouter
    // envoyé à Groq est un 404 garanti.
    const groqModel =
      voiceModel.provider === 'groq'
        ? voiceModel
        : resolveModel(undefined, DEFAULT_SHORT_VOICE_KEY)

    const groqOptions: TranscriptionOptions = {
      asrModel: groqModel.slug,
      vocabulary: context.vocabularyWords,
      noSpeechThreshold: advancedSettings.llm.noSpeechThreshold,
      fileType: 'wav',
      language: languageHint,
      customPrompt: mode.asrPrompt,
    }

    // Décide une fois, avant toute tentative réseau, quel transport prend
    // l'audio — pas de sondage inline comme avant : la durée, la taille et la
    // diarisation demandée sont déjà connues.
    const decision = chooseTranscriptionPath({
      voiceModelProvider: voiceModel.provider,
      durationMs,
      wavBytes: wavAudio.length,
      identifySpeakers: mode.identifySpeakers,
      hasOpenRouterKey: !!advancedSettings.openRouterApiKey?.trim(),
      hasDeepgramKey: !!advancedSettings.deepgramApiKey?.trim(),
    })

    if (decision.path === null) {
      // Ni transport court ni Deepgram : le WAV reste sur disque (voir le
      // catch plus bas) et l'utilisateur sait pourquoi, plutôt que de perdre
      // la dictée en silence.
      throw new LocalTranscriptionError(decision.reason, 'MODEL_ERROR')
    }

    let transcript: string
    // Groq is the default attribution; overwritten when Deepgram or
    // OpenRouter answers.
    let asrEngine = groqModel.slug
    let asrFallback: AsrFallback | undefined
    let speakerSegments: SpeakerSegment[] = []
    try {
      transcript = await timingCollector.timeAsync(timingEvent, async () => {
        if (decision.path === 'deepgram') {
          try {
            const result = await this.withRetry(
              `Deepgram (${voiceModel.slug})`,
              OPENROUTER_RETRY,
              () =>
                deepgramTranscriptionService.transcribeAudio(wavAudio, {
                  apiKey: advancedSettings.deepgramApiKey || '',
                  model: 'nova-3',
                  language: languageHint,
                  diarize: mode.identifySpeakers,
                }),
            )
            asrEngine = 'deepgram/nova-3'
            speakerSegments = result.segments
            return result.text
          } catch (error: any) {
            // Same guarantee as OpenRouter below: a failed precise engine
            // falls through to Groq rather than losing the dictation.
            asrFallback = this.recordProviderFallback(error, 'deepgram/nova-3')
          }
        } else if (decision.path === 'openrouter') {
          const apiKey = advancedSettings.openRouterApiKey || ''
          const openRouterModel = voiceModel.slug
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
                    language: languageHint,
                    customPrompt: mode.asrPrompt,
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

    // Ce que le moteur vocal a réellement rendu. C'est la moitié gauche d'une
    // paire d'exemple, et l'onglet « Original » de l'historique : sans elle,
    // corriger un mode à partir de ses échecs est impossible.
    const rawTranscript = transcript

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
      mode,
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
      speakerSegments,
      modeId: mode.id,
      modeName: mode.name,
      rawTranscript,
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

  /**
   * Deepgram failure, logged and surfaced the same way an OpenRouter one is.
   * Doesn't persist the failure to settings yet — that skip-the-retry
   * optimisation is OpenRouter-only until `openRouterHealth` generalizes into
   * a per-provider record (task 3.3bis).
   */
  private recordProviderFallback(error: any, model: string): AsrFallback {
    const code = error?.code || 'UNKNOWN'
    const message = error?.message || 'Deepgram request failed'

    console.warn(
      `[ItoStreamController] ${model} failed (${code}), falling back to Groq:`,
      message,
    )
    showNotification(
      'Ito — repli sur Groq',
      'La transcription Deepgram a échoué ; la dictée est transcrite par Groq.',
    )

    return { from: model, code, message }
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

      // Une dictée en attente n'a plus son mode : le WAV a survécu, pas le
      // contexte. Le mode actif est la meilleure approximation disponible, et
      // il ne sert ici qu'à la langue et à l'amorce de style.
      const mode = await resolveActiveMode()
      const groqModel = resolveModel(
        mode.voiceModelKey ?? undefined,
        DEFAULT_SHORT_VOICE_KEY,
      )
      const asrModel =
        groqModel.provider === 'groq'
          ? groqModel.slug
          : resolveModel(undefined, DEFAULT_SHORT_VOICE_KEY).slug

      for (const filePath of pending) {
        // A live recording takes priority over recovery work.
        if (this.audioStreamManager.isCurrentlyStreaming()) break

        try {
          const wavAudio = pendingDictationStore.read(filePath)
          const transcript = await localTranscriptionService.transcribeAudio(
            wavAudio,
            {
              asrModel,
              noSpeechThreshold: advancedSettings.llm.noSpeechThreshold,
              fileType: 'wav',
              language: asrLanguageHint(mode.language),
              customPrompt: mode.asrPrompt,
            },
          )
          if (transcript) {
            await interactionManager.createRecoveredInteraction(
              transcript,
              16000,
              filePath,
              undefined,
              asrModel,
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
