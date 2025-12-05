import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { ItoMode } from '@/app/generated/ito_pb'

const mockAudioStreamManager = {
  isCurrentlyStreaming: mock(() => false),
  initialize: mock(),
  stopStreaming: mock(),
  getAllAudio: mock(() => Buffer.from('pcm')),
  getCurrentSampleRate: mock(() => 16000),
  clearInteractionAudio: mock(),
  getAudioDurationMs: mock(() => 200),
}
mock.module('./audio/AudioStreamManager', () => ({
  AudioStreamManager: class MockAudioStreamManager {
    isCurrentlyStreaming = mockAudioStreamManager.isCurrentlyStreaming
    initialize = mockAudioStreamManager.initialize
    stopStreaming = mockAudioStreamManager.stopStreaming
    getAllAudio = mockAudioStreamManager.getAllAudio
    getCurrentSampleRate = mockAudioStreamManager.getCurrentSampleRate
    clearInteractionAudio = mockAudioStreamManager.clearInteractionAudio
    getAudioDurationMs = mockAudioStreamManager.getAudioDurationMs
  },
}))

const mockLocalAudioProcessor = {
  prepareAudioForTranscription: mock(() => ({
    wavAudio: Buffer.from('wav'),
    sampleRate: 16000,
    durationMs: 500,
  })),
}
mock.module('./transcription/LocalAudioProcessor', () => ({
  localAudioProcessor: mockLocalAudioProcessor,
}))

const mockContextGrabber = {
  gatherContext: mock(() =>
    Promise.resolve({
      windowTitle: 'Win',
      appName: 'App',
      contextText: 'Ctx',
      vocabularyWords: [],
      advancedSettings: {
        llm: {
          asrModel: 'whisper',
          noSpeechThreshold: 0.5,
          llmModel: 'llama3',
          llmTemperature: 0.2,
          editingPrompt: '',
          asrProvider: '',
          asrPrompt: '',
          llmProvider: '',
          transcriptionPrompt: '',
        },
        grammarServiceEnabled: false,
        macosAccessibilityContextEnabled: false,
        groqApiKey: 'gsk_test',
      },
    }),
  ),
}
mock.module('./context/ContextGrabber', () => ({
  contextGrabber: mockContextGrabber,
}))

const mockLocalTranscriptionService = {
  initialize: mock(() => {}),
  transcribeAudio: mock(() => Promise.resolve('raw transcript')),
  adjustTranscript: mock(() => Promise.resolve('adjusted transcript')),
}
mock.module('./transcription/LocalTranscriptionService', () => ({
  localTranscriptionService: mockLocalTranscriptionService,
  LocalTranscriptionError: class extends Error {},
}))

const mockGetAdvancedSettings = mock(() => ({
  llm: {
    asrModel: 'whisper',
    noSpeechThreshold: 0.5,
    llmModel: 'llama3',
    llmTemperature: 0.2,
    editingPrompt: '',
    asrProvider: '',
    asrPrompt: '',
    llmProvider: '',
    transcriptionPrompt: '',
  },
  grammarServiceEnabled: false,
  macosAccessibilityContextEnabled: false,
  groqApiKey: 'gsk_test',
}))
mock.module('./store', () => ({
  getAdvancedSettings: mockGetAdvancedSettings,
}))

describe('ItoStreamController (local)', () => {
  beforeEach(() => {
    Object.values(mockAudioStreamManager).forEach(fn => fn.mockClear())
    Object.values(mockLocalAudioProcessor).forEach(fn => fn.mockClear())
    Object.values(mockContextGrabber).forEach(fn => fn.mockClear())
    Object.values(mockLocalTranscriptionService).forEach(fn => fn.mockClear())
  })

  test('initializes and processes audio locally', async () => {
    const { ItoStreamController } = await import('./itoStreamController')
    const controller = new ItoStreamController()

    await controller.initialize(ItoMode.TRANSCRIBE)
    const result = await controller.processLocalTranscription()

    expect(mockAudioStreamManager.initialize).toHaveBeenCalled()
    expect(mockLocalAudioProcessor.prepareAudioForTranscription).toHaveBeenCalled()
    expect(mockLocalTranscriptionService.transcribeAudio).toHaveBeenCalled()
    expect(result.transcript).toBe('adjusted transcript')
  })
})
