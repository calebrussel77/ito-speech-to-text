import { clipboard, Notification } from 'electron'
import { voiceInputService } from './voiceInputService'
import { recordingStateNotifier } from './recordingStateNotifier'
import {
  itoStreamController,
  LocalTranscriptionResult,
} from './itoStreamController'
import { TextInserter } from './text/TextInserter'
import { interactionManager } from './interactions/InteractionManager'
import { contextGrabber } from './context/ContextGrabber'
import { GrammarRulesService } from './grammar/GrammarRulesService'
import store, { getAdvancedSettings } from './store'
import log from 'electron-log'
import { timingCollector, TimingEventName } from './timing/TimingCollector'
import { LocalTranscriptionError } from './transcription/LocalTranscriptionService'
import { UNRECOVERABLE_CODES } from '../constants/transcription'
import { STORE_KEYS } from '../constants/store-keys'
import { playInteractionCompletionSound } from './soundFeedback'
import { resolveMode, resolveActiveMode } from './modes/activeMode'
import type { Mode } from './sqlite/models'

function showNotification(title: string, body: string) {
  try {
    if (Notification?.isSupported?.()) {
      new Notification({ title, body }).show()
    }
  } catch (error) {
    console.warn('[itoSessionManager] Failed to show notification:', error)
  }
}

export type SessionState = 'idle' | 'starting' | 'recording' | 'processing'

export class ItoSessionManager {
  private readonly MINIMUM_AUDIO_DURATION_MS = 100
  private textInserter = new TextInserter()
  private grammarRulesService = new GrammarRulesService('')

  // Explicit session state machine. All entry points (keyboard handler, pill
  // IPC) funnel through this class, so guarding transitions here makes
  // interleaved start/complete/cancel calls safe without callers awaiting.
  private state: SessionState = 'idle'
  private startPromise: Promise<string | null> | null = null
  private currentMode: Mode | null = null

  public getState(): SessionState {
    return this.state
  }

  /** `modeId` absent = le mode actif. */
  public async startSession(modeId?: string): Promise<string | null> {
    if (this.state !== 'idle') {
      console.log(
        `[itoSessionManager] Ignoring startSession while ${this.state}`,
      )
      return null
    }

    this.state = 'starting'
    this.startPromise = this.doStartSession(modeId)
    try {
      return await this.startPromise
    } finally {
      this.startPromise = null
    }
  }

  private async doStartSession(modeId?: string): Promise<string | null> {
    const mode = modeId ? await resolveMode(modeId) : await resolveActiveMode()
    console.log(`[itoSessionManager] Starting session in mode "${mode.name}"`)
    this.currentMode = mode

    let interactionId = interactionManager.getCurrentInteractionId()
    if (interactionId) {
      console.log(
        '[itoSessionManager] Reusing existing interaction ID:',
        interactionId,
      )
      interactionManager.adoptInteractionId(interactionId)
    } else {
      interactionId = interactionManager.initialize()
    }

    const started = await itoStreamController.initialize(mode)
    if (!started) {
      log.error('[itoSessionManager] Failed to initialize itoStreamController')
      this.state = 'idle'
      // Keep the UI in sync: nothing is recording.
      recordingStateNotifier.notifyRecordingStopped()
      return null
    }

    voiceInputService.startAudioRecording()
    itoStreamController.setMode(mode)
    recordingStateNotifier.notifyRecordingStarted(mode)

    // Grammar context is NOT gathered here: it simulates keystrokes, and the
    // push-to-talk keys are still physically held at this point (held Alt +
    // simulated Ctrl+C = "©" typed into the focused app). It runs during
    // completeSession instead, in parallel with the transcription call.

    timingCollector.startInteraction()
    timingCollector.startTiming(TimingEventName.INTERACTION_ACTIVE)

    this.state = 'recording'
    return interactionId
  }

  private async prepareGrammarContext() {
    this.grammarRulesService = new GrammarRulesService('')
    const { grammarServiceEnabled } = getAdvancedSettings()
    if (grammarServiceEnabled) {
      const cursorContext = await timingCollector.timeAsync(
        TimingEventName.GRAMMAR_SERVICE,
        async () => await contextGrabber.getCursorContextForGrammar(),
      )
      this.grammarRulesService = new GrammarRulesService(cursorContext)
    }
  }

  public async setMode(modeId: string) {
    if (this.state !== 'starting' && this.state !== 'recording') {
      console.log(`[itoSessionManager] Ignoring setMode while ${this.state}`)
      return
    }
    const mode = await resolveMode(modeId)
    this.currentMode = mode
    itoStreamController.setMode(mode)
    recordingStateNotifier.notifyRecordingStarted(mode)
  }

  public async cancelSession() {
    // Valid from any state: cancel is a force-reset to idle and doubles as a
    // recovery escape hatch when something upstream got out of sync.
    if (this.startPromise) {
      await this.startPromise.catch(() => {})
    }
    this.state = 'idle'

    timingCollector.clearInteraction()
    itoStreamController.cancelTranscription()
    interactionManager.clearCurrentInteraction()

    await voiceInputService.stopAudioRecording()
    recordingStateNotifier.notifyRecordingStopped()
    this.grammarRulesService = new GrammarRulesService('')
  }

  public async completeSession() {
    // A fast press/release can fire completion while the session is still
    // starting: wait for the start to settle, then decide.
    if (this.startPromise) {
      await this.startPromise.catch(() => {})
    }

    if (this.state !== 'recording') {
      console.log(
        `[itoSessionManager] Ignoring completeSession while ${this.state}`,
      )
      return
    }
    this.state = 'processing'

    try {
      timingCollector.endTiming(TimingEventName.INTERACTION_ACTIVE)
      await voiceInputService.stopAudioRecording()

      const audioDurationMs = itoStreamController.getAudioDurationMs()
      if (audioDurationMs < this.MINIMUM_AUDIO_DURATION_MS) {
        console.log(
          `[itoSessionManager] Audio too short (${audioDurationMs}ms < ${this.MINIMUM_AUDIO_DURATION_MS}ms), cancelling`,
        )
        itoStreamController.cancelTranscription()
        recordingStateNotifier.notifyRecordingStopped()
        return
      }

      itoStreamController.endInteraction()
      recordingStateNotifier.notifyRecordingStopped()
      recordingStateNotifier.notifyProcessingStarted()

      // Runs in parallel with the transcription network call; it waits for
      // the keyboard to be fully released before simulating anything.
      const grammarContextReady = this.prepareGrammarContext().catch(error => {
        log.error('[itoSessionManager] Failed to fetch grammar context:', error)
      })

      try {
        const result = await itoStreamController.processLocalTranscription()
        await grammarContextReady
        await this.handleTranscriptionResponse(result)
      } catch (error) {
        await this.handleTranscriptionError(error)
      } finally {
        recordingStateNotifier.notifyProcessingStopped()
      }
    } finally {
      // cancelSession may already have reset the state while we were
      // processing; only leave 'processing' if we still own it.
      if (this.state === 'processing') {
        this.state = 'idle'
      }
    }
  }

  private async handleTranscriptionResponse(result: LocalTranscriptionResult) {
    const { transcript, sampleRate, durationMs } = result

    if (this.state !== 'processing') {
      console.log(
        '[itoSessionManager] Session cancelled during processing, discarding transcript',
      )
      return
    }

    if (transcript) {
      const mode = this.currentMode
      let textToInsert = transcript
      const { grammarServiceEnabled } = getAdvancedSettings()
      if (grammarServiceEnabled) {
        if (mode?.autocapitalize !== false) {
          textToInsert = this.grammarRulesService.setCaseFirstWord(textToInsert)
        }
        textToInsert =
          this.grammarRulesService.addLeadingSpaceIfNeeded(textToInsert)
      }

      // Auto-paste off : le presse-papier plutôt que le curseur, avec une
      // notification — aucune fenêtre supplémentaire (décision D13).
      if (mode?.autoPaste !== false) {
        this.textInserter.insertText(textToInsert)
      } else {
        clipboard.writeText(textToInsert)
        showNotification(
          'Ito — copié',
          'Le résultat est dans le presse-papier.',
        )
      }

      await interactionManager.createInteraction(
        transcript,
        Buffer.alloc(0),
        sampleRate,
        undefined,
        undefined,
        durationMs,
        {
          engine: result.asrEngine,
          fallback: result.asrFallback,
          modeId: result.modeId,
          modeName: result.modeName,
          rawTranscript: result.rawTranscript,
        },
      )
      this.playInteractionCompletionSoundIfEnabled()
      console.log(
        '[itoSessionManager] Interaction stored (audio omitted) duration:',
        durationMs,
      )
    } else {
      log.warn('[itoSessionManager] No transcript returned from Groq')
    }

    timingCollector.finalizeInteraction()
    interactionManager.clearCurrentInteraction()
    itoStreamController.clearInteractionAudio()
  }

  private async handleTranscriptionError(error: any) {
    const message =
      error instanceof LocalTranscriptionError
        ? error.message
        : error?.message || 'Unknown transcription error'

    log.error('[itoSessionManager] Transcription failed:', message)

    // Silence and sub-100ms clips are not worth a history row — the user
    // simply tapped the shortcut. Everything else is a real failure the user
    // must be able to see, with the audio still queued for a retry.
    // Never let bookkeeping throw here: this is the last chance to leave a
    // trace of the dictation.
    if (!UNRECOVERABLE_CODES.has(error?.code)) {
      try {
        await interactionManager.createFailedInteraction({
          errorMessage: message,
          errorCode: error?.code,
          sampleRate: itoStreamController.getCurrentSampleRate(),
          audioDurationMs: error?.audioDurationMs,
          pendingPath: error?.pendingDictationPath,
        })
      } catch (bookkeepingError) {
        log.error(
          '[itoSessionManager] Could not record the failed dictation:',
          bookkeepingError,
        )
      }
    }

    timingCollector.clearInteraction()
    interactionManager.clearCurrentInteraction()
  }

  private playInteractionCompletionSoundIfEnabled() {
    const settings = store.get(STORE_KEYS.SETTINGS)
    if (settings?.interactionSounds) {
      playInteractionCompletionSound()
    }
  }
}

export const itoSessionManager = new ItoSessionManager()
