import { ItoMode } from '@/app/generated/ito_pb'
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
import { STORE_KEYS } from '../constants/store-keys'
import { shell } from 'electron'

export class ItoSessionManager {
  private readonly MINIMUM_AUDIO_DURATION_MS = 100
  private textInserter = new TextInserter()
  private grammarRulesService = new GrammarRulesService('')

  public async startSession(mode: ItoMode) {
    console.log('[itoSessionManager] Starting session with mode:', mode)

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
      return
    }

    voiceInputService.startAudioRecording()
    itoStreamController.setMode(mode)
    recordingStateNotifier.notifyRecordingStarted(mode)

    this.prepareGrammarContext().catch(error => {
      log.error('[itoSessionManager] Failed to fetch grammar context:', error)
    })

    timingCollector.startInteraction()
    timingCollector.startTiming(TimingEventName.INTERACTION_ACTIVE)

    return interactionId
  }

  private async prepareGrammarContext() {
    const { grammarServiceEnabled } = getAdvancedSettings()
    if (grammarServiceEnabled) {
      const cursorContext = await timingCollector.timeAsync(
        TimingEventName.GRAMMAR_SERVICE,
        async () => await contextGrabber.getCursorContextForGrammar(),
      )
      this.grammarRulesService = new GrammarRulesService(cursorContext)
    }
  }

  public setMode(mode: ItoMode) {
    itoStreamController.setMode(mode)
    recordingStateNotifier.notifyRecordingStarted(mode)
  }

  public async cancelSession() {
    timingCollector.clearInteraction()
    itoStreamController.cancelTranscription()
    interactionManager.clearCurrentInteraction()

    await voiceInputService.stopAudioRecording()
    recordingStateNotifier.notifyRecordingStopped()
    this.grammarRulesService = new GrammarRulesService('')
  }

  public async completeSession() {
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

    try {
      const result = await itoStreamController.processLocalTranscription()
      await this.handleTranscriptionResponse(result)
    } catch (error) {
      await this.handleTranscriptionError(error)
    } finally {
      recordingStateNotifier.notifyProcessingStopped()
    }
  }

  private async handleTranscriptionResponse(result: LocalTranscriptionResult) {
    const { transcript, sampleRate, durationMs } = result

    if (transcript) {
      let textToInsert = transcript
      const { grammarServiceEnabled } = getAdvancedSettings()
      if (grammarServiceEnabled) {
        textToInsert = this.grammarRulesService.setCaseFirstWord(textToInsert)
        textToInsert =
          this.grammarRulesService.addLeadingSpaceIfNeeded(textToInsert)
      }

      this.textInserter.insertText(textToInsert)

      await interactionManager.createInteraction(
        transcript,
        Buffer.alloc(0),
        sampleRate,
        undefined,
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
    timingCollector.clearInteraction()
    interactionManager.clearCurrentInteraction()
  }

  private playInteractionCompletionSoundIfEnabled() {
    const settings = store.get(STORE_KEYS.SETTINGS)
    if (settings?.interactionSounds) {
      shell.beep()
    }
  }
}

export const itoSessionManager = new ItoSessionManager()
