import { ItoMode } from '@/app/generated/ito_pb'
import log from 'electron-log'
import { AudioStreamManager } from './audio/AudioStreamManager'
import { localAudioProcessor } from './transcription/LocalAudioProcessor'
import {
  localTranscriptionService,
  LocalTranscriptionError,
} from './transcription/LocalTranscriptionService'
import { contextGrabber } from './context/ContextGrabber'
import { getAdvancedSettings } from './store'
import { timingCollector, TimingEventName } from './timing/TimingCollector'

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
   */
  public async processLocalTranscription(): Promise<LocalTranscriptionResult> {
    const rawAudio = this.audioStreamManager.getAllAudio()
    const sampleRate = this.audioStreamManager.getCurrentSampleRate()

    const { wavAudio, durationMs } = localAudioProcessor.prepareAudioForTranscription(
      rawAudio,
      { sampleRate },
    )

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

    const transcript = await timingCollector.timeAsync(
      timingEvent,
      async () =>
        await localTranscriptionService.transcribeAudio(wavAudio, {
          asrModel: advancedSettings.llm.asrModel,
          vocabulary: context.vocabularyWords,
          noSpeechThreshold: advancedSettings.llm.noSpeechThreshold,
          fileType: 'wav',
          language: advancedSettings.llm.asrLanguage,
          customPrompt: advancedSettings.llm.asrPrompt,
        }),
    )

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
}

export const itoStreamController = new ItoStreamController()
