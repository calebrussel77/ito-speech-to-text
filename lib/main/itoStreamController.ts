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
import { showNotification } from './notifications'
import type { Mode } from './sqlite/models'
import { resolveModeOrActive } from './modes/activeMode'
import { openRouterTranscriptionService } from './transcription/OpenRouterTranscriptionService'
import { openaiTranscriptionService } from './transcription/OpenAITranscriptionService'
import { googleTranscriptionService } from './transcription/GoogleTranscriptionService'
import {
  deepgramTranscriptionService,
  type SpeakerSegment,
} from './transcription/DeepgramTranscriptionService'
import {
  chooseTranscriptionPath,
  type TranscriptionPath,
} from './transcription/transcriptionRouter'
import {
  clearProviderFailure,
  failureNotice,
  getRejectedKeyFailure,
  recordProviderFailure,
  type Provider,
} from './transcription/providerHealth'
import { transcriptAdjuster } from './transcription/TranscriptAdjuster'
import {
  pendingDictationStore,
  type PendingDictationMeta,
} from './transcription/PendingDictationStore'
import { applyDictionaryCorrections } from './transcription/DictionaryCorrector'
import { sanitizeTranscript } from './transcription/hallucinationFilter'
import { interactionManager } from './interactions/InteractionManager'
import { recordingStateNotifier } from './recordingStateNotifier'
import { contextGrabber, type ContextData } from './context/ContextGrabber'
import { getAdvancedSettings, type AdvancedSettings } from './store'
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

const NO_RETRY: RetryPolicy = { attempts: 1, maxDelayMs: 0 }

// Two minutes: long enough not to hammer a dead network, short enough that a
// dictation is back in the history soon after the connection returns.
const PENDING_BACKSTOP_MS = 2 * 60 * 1000

/** Ce que le moteur vocal a besoin de savoir du contexte de la dictée. */
type AsrContext = Pick<ContextData, 'vocabularyWords' | 'dictionaryEntries'>

interface AsrOutcome {
  rawTranscript: string
  asrEngine: string
  asrFallback?: AsrFallback
  speakerSegments: SpeakerSegment[]
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
  /** Où est passé le temps, étape par étape, pour l'historique. */
  latency: TranscriptionLatency
}

export interface TranscriptionLatency {
  /** Préparation du WAV (silence, filtre, gain) — thread principal. */
  prepareMs: number
  /** Capture du contexte, en parallèle de l'ASR. */
  contextMs: number
  /** Appel(s) moteur vocal, repli compris. */
  asrMs: number
  /** Réécriture par le modèle texte du mode (0 sans LLM). */
  adjustMs: number
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
   * Process the buffered audio through the mode's engines and return the
   * final transcript. The WAV (plus its mode and context) is persisted to
   * disk before the network call and removed after success, so a failure at
   * any point never loses the dictation.
   *
   * Ordre des opérations, pensé pour la latence : l'upload ASR part dès que
   * le WAV est prêt, avec le seul vocabulaire (une lecture SQLite). La
   * capture du contexte — fenêtre active, sélection par Ctrl+C simulé après
   * relâchement des touches — tourne en parallèle et n'est attendue qu'au
   * moment de la réécriture LLM, la seule étape qui s'en sert.
   */
  public async processLocalTranscription(): Promise<LocalTranscriptionResult> {
    const startedAt = performance.now()
    const rawAudio = this.audioStreamManager.getAllAudio()
    const sampleRate = this.audioStreamManager.getCurrentSampleRate()

    const { wavAudio, durationMs } =
      localAudioProcessor.prepareAudioForTranscription(rawAudio, { sampleRate })
    const prepareMs = Math.round(performance.now() - startedAt)

    const mode = this.currentMode
    if (!mode) throw new Error('No mode set on the stream controller')

    // Écriture disque en arrière-plan : elle n'est nécessaire qu'en cas
    // d'échec, où elle est attendue avant de lier la ligne d'historique.
    const pendingReady: Promise<string | null> = pendingDictationStore
      .saveAsync(wavAudio)
      .catch(error => {
        console.warn(
          '[ItoStreamController] Could not persist dictation audio:',
          error,
        )
        return null
      })

    const contextStartedAt = performance.now()
    const contextReady = contextGrabber.gatherContext(mode)
    let contextMs = 0
    const metaReady = Promise.all([pendingReady, contextReady])
      .then(([pendingPath, context]) => {
        contextMs = Math.round(performance.now() - contextStartedAt)
        // Le sidecar permet à la reprise de rejouer la dictée avec le même
        // mode et le même contexte que maintenant.
        if (!pendingPath) return
        pendingDictationStore.writeMeta(pendingPath, {
          modeId: mode.id,
          modeName: mode.name,
          durationMs,
          context: {
            vocabularyWords: context.vocabularyWords,
            dictionaryEntries: context.dictionaryEntries,
            windowTitle: context.windowTitle,
            appName: context.appName,
            contextText: context.contextText,
            clipboardText: context.clipboardText,
          },
        })
      })
      .catch(() => {})

    const advancedSettings = getAdvancedSettings()
    this.initializeGroq(advancedSettings.groqApiKey)

    let asr: AsrOutcome
    let asrMs = 0
    try {
      const decision = this.decidePath(
        mode,
        wavAudio,
        durationMs,
        advancedSettings,
      )
      // This throw must stay inside the try: the catch right below is what
      // links the WAV (`error.pendingDictationPath`), carries the duration
      // (`error.audioDurationMs`) and shows the "dictée sauvegardée"
      // notification. Thrown ahead of the try (as it once was), none of that
      // bookkeeping runs — the WAV survives on disk but with no notification,
      // no link back to it, and no duration, so it can never be reconciled by
      // `findPendingInteraction` even after `flushPendingDictations` learns
      // to route through the file path. Second time this exact ordering has
      // bitten this function — keep it here.
      if (decision.path === null) {
        throw new LocalTranscriptionError(decision.reason, 'MODEL_ERROR')
      }
      const path = decision.path
      const vocabulary = await contextGrabber.getVocabulary()
      const timingEvent = mode.useLlm
        ? TimingEventName.LOCAL_EDIT
        : TimingEventName.LOCAL_TRANSCRIBE
      const asrStartedAt = performance.now()
      asr = await timingCollector.timeAsync(timingEvent, () =>
        this.runAsr(path, wavAudio, mode, vocabulary, advancedSettings),
      )
      asrMs = Math.round(performance.now() - asrStartedAt)
    } catch (error: any) {
      const pendingPath = await pendingReady
      await metaReady
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

    const context = await contextReady
    await metaReady
    const pendingPath = await pendingReady
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

    const adjustStartedAt = performance.now()
    const adjusted = await transcriptAdjuster.adjust(
      asr.rawTranscript,
      mode,
      context,
      advancedSettings,
    )
    const adjustMs = Math.round(performance.now() - adjustStartedAt)

    return {
      transcript: adjusted,
      audioBuffer: Buffer.alloc(0), // We intentionally avoid persisting audio
      sampleRate,
      durationMs,
      asrEngine: asr.asrEngine,
      asrFallback: asr.asrFallback,
      speakerSegments: asr.speakerSegments,
      modeId: mode.id,
      modeName: mode.name,
      rawTranscript: asr.rawTranscript,
      latency: { prepareMs, contextMs, asrMs, adjustMs },
    }
  }

  private initializeGroq(groqApiKey: string | undefined) {
    try {
      localTranscriptionService.initialize(groqApiKey || '')
    } catch (error) {
      if (error instanceof LocalTranscriptionError) {
        throw error
      }
      throw new Error(
        error instanceof Error ? error.message : 'Groq API key missing',
      )
    }
  }

  /**
   * Le modèle vocal du mode et son repli Groq. Le repli garde un modèle
   * Groq : le slug d'un modèle OpenRouter envoyé à Groq est un 404 garanti.
   */
  private resolveVoiceModels(mode: Mode) {
    const voiceModel = resolveModel(
      mode.voiceModelKey ?? undefined,
      DEFAULT_SHORT_VOICE_KEY,
    )
    const groqModel =
      voiceModel.provider === 'groq'
        ? voiceModel
        : resolveModel(undefined, DEFAULT_SHORT_VOICE_KEY)
    return { voiceModel, groqModel }
  }

  // Décide une fois, avant toute tentative réseau, quel transport prend
  // l'audio : la durée, la taille et la diarisation demandée sont connues.
  private decidePath(
    mode: Mode,
    wavAudio: Buffer,
    durationMs: number,
    advancedSettings: AdvancedSettings,
  ) {
    const { voiceModel } = this.resolveVoiceModels(mode)
    return chooseTranscriptionPath({
      voiceModelProvider: voiceModel.provider,
      durationMs,
      wavBytes: wavAudio.length,
      identifySpeakers: mode.identifySpeakers,
      hasOpenRouterKey: !!advancedSettings.openRouterApiKey?.trim(),
      hasDeepgramKey: !!advancedSettings.deepgramApiKey?.trim(),
      hasOpenAIKey: !!advancedSettings.openaiApiKey?.trim(),
      hasGoogleKey: !!advancedSettings.googleApiKey?.trim(),
    })
  }

  /**
   * Le cœur partagé par la dictée en direct et la reprise d'une dictée en
   * attente : moteur précis du mode (avec saut de clé refusée et repli
   * Groq), puis correction dictionnaire. Rend le transcript brut ; la
   * réécriture LLM du mode reste à l'appelant.
   */
  private async runAsr(
    path: TranscriptionPath,
    wavAudio: Buffer,
    mode: Mode,
    context: AsrContext,
    advancedSettings: AdvancedSettings,
    options: { retry: boolean } = { retry: true },
  ): Promise<AsrOutcome> {
    const { voiceModel, groqModel } = this.resolveVoiceModels(mode)
    const languageHint = asrLanguageHint(mode.language)
    // La reprise tourne déjà en boucle à chaque passe : pas de réessai
    // interne en plus, un échec la remet simplement à plus tard.
    const groqRetry = options.retry ? GROQ_RETRY : NO_RETRY
    const preciseRetry = options.retry ? OPENROUTER_RETRY : NO_RETRY

    const groqOptions: TranscriptionOptions = {
      asrModel: groqModel.slug,
      vocabulary: context.vocabularyWords,
      noSpeechThreshold: advancedSettings.llm.noSpeechThreshold,
      fileType: 'wav',
      language: languageHint,
      customPrompt: mode.asrPrompt,
    }

    // Groq is the default attribution; overwritten when a precise engine
    // answers.
    let asrEngine = groqModel.slug
    let asrFallback: AsrFallback | undefined
    let speakerSegments: SpeakerSegment[] = []

    // Le moteur précis du mode. `undefined` = à Groq de prendre le relais :
    // clé déjà refusée (saut direct, sans ré-uploader la dictée pour un 401
    // certain) ou échec (enregistré et annoncé). Dans les deux cas la
    // dictée n'est jamais perdue ni bloquée, et le repli n'est jamais
    // maquillé en dictée normale.
    const precise = async (): Promise<string | undefined> => {
      if (path === 'groq') return undefined

      const provider: Provider = path
      const model = path === 'deepgram' ? 'deepgram/nova-3' : voiceModel.slug
      const apiKey =
        (path === 'deepgram'
          ? advancedSettings.deepgramApiKey
          : path === 'openrouter'
            ? advancedSettings.openRouterApiKey
            : path === 'openai'
              ? advancedSettings.openaiApiKey
              : advancedSettings.googleApiKey) || ''

      const rejected = getRejectedKeyFailure(provider, apiKey)
      if (rejected) {
        console.warn(
          `[ItoStreamController] Skipping ${provider}: the stored key was refused on ${rejected.at}`,
        )
        asrFallback = {
          from: model,
          code: rejected.code,
          message: rejected.message,
        }
        return undefined
      }

      try {
        const text = await this.withRetry(
          `${provider} (${model})`,
          preciseRetry,
          async () => {
            if (path === 'deepgram') {
              const result = await deepgramTranscriptionService.transcribeAudio(
                wavAudio,
                {
                  apiKey,
                  model: 'nova-3',
                  language: languageHint,
                  diarize: mode.identifySpeakers,
                },
              )
              speakerSegments = result.segments
              return result.text
            }
            if (path === 'openrouter') {
              return openRouterTranscriptionService.transcribeAudio(wavAudio, {
                apiKey,
                model,
                vocabulary: context.vocabularyWords,
                language: languageHint,
                customPrompt: mode.asrPrompt,
              })
            }
            if (path === 'openai') {
              const result = await openaiTranscriptionService.transcribeAudio(
                wavAudio,
                {
                  apiKey,
                  model,
                  language: languageHint,
                  contentType: 'audio/wav',
                  fileName: 'dictation.wav',
                },
              )
              return result.text
            }
            const result = await googleTranscriptionService.transcribeAudio(
              wavAudio,
              {
                apiKey,
                model,
                language: languageHint,
                contentType: 'audio/wav',
              },
            )
            return result.text
          },
        )
        asrEngine = model
        clearProviderFailure(provider)
        return text
      } catch (error: any) {
        speakerSegments = []
        asrFallback = this.recordProviderFallback(
          error,
          model,
          apiKey,
          provider,
        )
        return undefined
      }
    }

    const engineText =
      (await precise()) ??
      (await this.withRetry('Groq', groqRetry, () =>
        localTranscriptionService.transcribeAudio(wavAudio, groqOptions),
      ))

    // Filet commun à tous les moteurs : Groq filtre déjà par segment, les
    // autres n'ont rien. Un texte qui n'est qu'une hallucination classique
    // vaut un silence, et une phrase bouclée est ramenée à une occurrence.
    const transcript = sanitizeTranscript(engineText)
    if (!transcript.trim() && engineText.trim()) {
      throw new LocalTranscriptionError(
        'Transcript was only a known hallucination',
        'NO_SPEECH',
      )
    }

    // The dictionary is authoritative: fix near-miss spellings of user terms
    // that Whisper mangled (deterministic, local, no added latency). What
    // comes out is what the voice engine really rendered — the "Original"
    // tab of the history and the left half of an example pair.
    const rawTranscript = applyDictionaryCorrections(
      transcript,
      context.dictionaryEntries,
    )

    return { rawTranscript, asrEngine, asrFallback, speakerSegments }
  }

  /**
   * Turns a precise-engine failure (OpenRouter or Deepgram) into the three
   * traces it deserves: a line in the log, a notification that names the
   * actual cause, and a per-provider record in the settings that outlives
   * both — so a key already known to be refused can be skipped next time
   * (see `getRejectedKeyFailure`) instead of re-uploading the dictation for
   * another certain rejection.
   */
  private recordProviderFallback(
    error: any,
    model: string,
    apiKey: string,
    provider: Provider,
  ): AsrFallback {
    const code = error?.code || 'UNKNOWN'
    const message = error?.message || `${model} request failed`

    console.warn(
      `[ItoStreamController] ${model} failed (${code}), falling back to Groq:`,
      message,
    )
    recordProviderFailure({ provider, code, message, model, apiKey })
    showNotification('Ito — repli sur Groq', failureNotice(provider, code))

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
  private pendingBackstop: NodeJS.Timeout | null = null

  /**
   * Tant que des dictées attendent, réessaie périodiquement : la reprise
   * n'est sinon déclenchée qu'au démarrage et après une dictée réussie, et
   * un réseau revenu sans nouvelle dictée laisserait la file en l'état.
   */
  private schedulePendingBackstop(pendingCount: number) {
    if (pendingCount === 0) {
      if (this.pendingBackstop) clearTimeout(this.pendingBackstop)
      this.pendingBackstop = null
      return
    }
    if (this.pendingBackstop) return
    this.pendingBackstop = setTimeout(() => {
      this.pendingBackstop = null
      this.flushPendingDictations().catch(error =>
        console.warn('[ItoStreamController] Backstop flush failed:', error),
      )
    }, PENDING_BACKSTOP_MS)
    this.pendingBackstop.unref?.()
  }

  // Keeps the dashboard's "pending dictations" banner in sync with the disk
  // queue whenever it changes.
  private notifyPendingCount() {
    try {
      const count = pendingDictationStore.list().length
      recordingStateNotifier.notifyPendingDictations(count)
      this.schedulePendingBackstop(count)
    } catch (error) {
      console.warn('[ItoStreamController] Pending count notify failed:', error)
    }
  }

  /**
   * Transcribes dictations that previously failed and stores them in the
   * interaction history (no text insertion: the original cursor context is
   * long gone). Each WAV is replayed with the mode and context saved next to
   * it, through the same engines and the same rewrite as a live dictation.
   * Called at startup and after each successful transcription.
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
          const meta = pendingDictationStore.readMeta(filePath)
          const mode = await resolveModeOrActive(meta?.modeId)
          const context = await this.recoveryContext(meta, advancedSettings)

          // La durée d'origine vient du sidecar, sinon de l'en-tête du WAV :
          // repasser 0 ferait lire un enregistrement long comme s'il était
          // court, et l'enverrait vers Groq alors que le routeur l'aurait
          // réservé au chemin fichier (Deepgram). Un en-tête illisible ne
          // doit pas faire échouer tout le flush : 0 pour ce seul fichier.
          const durationMs =
            meta?.durationMs ??
            localAudioProcessor.getWavDurationMs(wavAudio) ??
            0

          const decision = this.decidePath(
            mode,
            wavAudio,
            durationMs,
            advancedSettings,
          )
          if (decision.path === null) {
            // Toujours rien pour le transporter (pas de clé Deepgram) : on
            // laisse le WAV sur disque pour la prochaine passe, sans le
            // supprimer ni boucler dessus.
            continue
          }

          const asr = await this.runAsr(
            decision.path,
            wavAudio,
            mode,
            context,
            advancedSettings,
            { retry: false },
          )
          const transcript = await transcriptAdjuster.adjust(
            asr.rawTranscript,
            mode,
            context,
            advancedSettings,
          )

          if (transcript) {
            await interactionManager.createRecoveredInteraction(
              transcript,
              16000,
              filePath,
              durationMs || undefined,
              asr.asrEngine,
              {
                rawTranscript: asr.rawTranscript,
                modeId: mode.id,
                modeName: mode.name,
                speakers: asr.speakerSegments,
              },
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

  /**
   * Le contexte d'une dictée en attente : celui figé dans le sidecar, ou —
   * pour un WAV d'avant les sidecars — le dictionnaire courant seul, sans
   * fenêtre ni sélection, qui n'ont plus de sens des heures plus tard.
   */
  private async recoveryContext(
    meta: PendingDictationMeta | null,
    advancedSettings: AdvancedSettings,
  ): Promise<ContextData> {
    if (meta) return { ...meta.context, advancedSettings }
    const { vocabularyWords, dictionaryEntries } =
      await contextGrabber.getVocabulary()
    return {
      vocabularyWords,
      dictionaryEntries,
      windowTitle: '',
      appName: '',
      contextText: '',
      clipboardText: '',
      advancedSettings,
    }
  }
}

export const itoStreamController = new ItoStreamController()
