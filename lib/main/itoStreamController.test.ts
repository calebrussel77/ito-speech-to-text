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

const mockPendingDictationStore = {
  save: mock(() => 'C:/pending/dictation-1.wav'),
  delete: mock(),
  read: mock(() => Buffer.from('wav')),
  list: mock((): string[] => []),
}
mock.module('./transcription/PendingDictationStore', () => ({
  pendingDictationStore: mockPendingDictationStore,
}))

const mockInteractionManager = {
  createRecoveredInteraction: mock(() => Promise.resolve()),
}
mock.module('./interactions/InteractionManager', () => ({
  interactionManager: mockInteractionManager,
}))

const mockContextGrabber = {
  gatherContext: mock(() =>
    Promise.resolve({
      windowTitle: 'Win',
      appName: 'App',
      contextText: 'Ctx',
      vocabularyWords: [],
      dictionaryEntries: [],
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

const mockCreateNewAuthState = mock(() => ({
  state: '',
  codeVerifier: '',
  codeChallenge: '',
  codeChallengeMethod: 'S256',
  createdAt: new Date().toISOString(),
}))
const mockGetCurrentUserId = mock(() => 'self-hosted')

mock.module('./store', () => ({
  createNewAuthState: mockCreateNewAuthState,
  getCurrentUserId: mockGetCurrentUserId,
  getAdvancedSettings: mockGetAdvancedSettings,
  defaultValues: {} as any,
  default: {
    get: mock(() => undefined),
    set: mock(() => {}),
    delete: mock(() => {}),
  },
  store: {
    get: mock(() => undefined),
    set: mock(() => {}),
    delete: mock(() => {}),
  },
}))

describe('ItoStreamController (local)', () => {
  beforeEach(() => {
    Object.values(mockAudioStreamManager).forEach(fn => fn.mockClear())
    Object.values(mockLocalAudioProcessor).forEach(fn => fn.mockClear())
    Object.values(mockContextGrabber).forEach(fn => fn.mockClear())
    Object.values(mockLocalTranscriptionService).forEach(fn => fn.mockClear())
    Object.values(mockPendingDictationStore).forEach(fn => fn.mockClear())
    Object.values(mockInteractionManager).forEach(fn => fn.mockClear())

    mockAudioStreamManager.isCurrentlyStreaming.mockReturnValue(false)
    mockLocalTranscriptionService.transcribeAudio.mockResolvedValue(
      'raw transcript',
    )
    mockPendingDictationStore.save.mockReturnValue('C:/pending/dictation-1.wav')
    mockPendingDictationStore.list.mockReturnValue([])
  })

  test('initializes and processes audio locally', async () => {
    const { ItoStreamController } = await import('./itoStreamController')
    const controller = new ItoStreamController()

    await controller.initialize(ItoMode.TRANSCRIBE)
    const result = await controller.processLocalTranscription()

    expect(mockAudioStreamManager.initialize).toHaveBeenCalled()
    expect(
      mockLocalAudioProcessor.prepareAudioForTranscription,
    ).toHaveBeenCalled()
    expect(mockLocalTranscriptionService.transcribeAudio).toHaveBeenCalled()
    expect(result.transcript).toBe('adjusted transcript')
  })

  test('persists the dictation before transcription and deletes it on success', async () => {
    const { ItoStreamController } = await import('./itoStreamController')
    const controller = new ItoStreamController()

    await controller.initialize(ItoMode.TRANSCRIBE)
    await controller.processLocalTranscription()

    expect(mockPendingDictationStore.save).toHaveBeenCalled()
    expect(mockPendingDictationStore.delete).toHaveBeenCalledWith(
      'C:/pending/dictation-1.wav',
    )
  })

  test('retries transient errors and eventually succeeds', async () => {
    const { LocalTranscriptionError } = await import(
      './transcription/LocalTranscriptionService'
    )
    const transientError = Object.assign(
      new (LocalTranscriptionError as any)('rate limited'),
      { code: 'RATE_LIMIT', retryAfterMs: 1 },
    )
    mockLocalTranscriptionService.transcribeAudio
      .mockRejectedValueOnce(transientError)
      .mockRejectedValueOnce(transientError)
      .mockResolvedValueOnce('raw transcript')

    const { ItoStreamController } = await import('./itoStreamController')
    const controller = new ItoStreamController()

    await controller.initialize(ItoMode.TRANSCRIBE)
    const result = await controller.processLocalTranscription()

    expect(mockLocalTranscriptionService.transcribeAudio).toHaveBeenCalledTimes(
      3,
    )
    expect(result.transcript).toBe('adjusted transcript')
    expect(mockPendingDictationStore.delete).toHaveBeenCalled()
  })

  test('does not retry non-retryable errors and keeps the saved audio', async () => {
    const { LocalTranscriptionError } = await import(
      './transcription/LocalTranscriptionService'
    )
    const fatalError = Object.assign(
      new (LocalTranscriptionError as any)('bad key'),
      { code: 'INVALID_API_KEY' },
    )
    mockLocalTranscriptionService.transcribeAudio.mockRejectedValue(fatalError)

    const { ItoStreamController } = await import('./itoStreamController')
    const controller = new ItoStreamController()

    await controller.initialize(ItoMode.TRANSCRIBE)
    await expect(controller.processLocalTranscription()).rejects.toMatchObject({
      code: 'INVALID_API_KEY',
    })

    expect(mockLocalTranscriptionService.transcribeAudio).toHaveBeenCalledTimes(
      1,
    )
    expect(mockPendingDictationStore.delete).not.toHaveBeenCalled()
  })

  test('drops the saved audio when the failure is unrecoverable (silence)', async () => {
    const { LocalTranscriptionError } = await import(
      './transcription/LocalTranscriptionService'
    )
    const noSpeechError = Object.assign(
      new (LocalTranscriptionError as any)('no speech'),
      { code: 'NO_SPEECH' },
    )
    mockLocalTranscriptionService.transcribeAudio.mockRejectedValue(
      noSpeechError,
    )

    const { ItoStreamController } = await import('./itoStreamController')
    const controller = new ItoStreamController()

    await controller.initialize(ItoMode.TRANSCRIBE)
    await expect(controller.processLocalTranscription()).rejects.toMatchObject({
      code: 'NO_SPEECH',
    })

    expect(mockPendingDictationStore.delete).toHaveBeenCalledWith(
      'C:/pending/dictation-1.wav',
    )
  })

  test('flushPendingDictations recovers pending files into the history', async () => {
    mockPendingDictationStore.list.mockReturnValue([
      'C:/pending/a.wav',
      'C:/pending/b.wav',
    ])

    const { ItoStreamController } = await import('./itoStreamController')
    const controller = new ItoStreamController()

    const recovered = await controller.flushPendingDictations()

    expect(recovered).toBe(2)
    expect(
      mockInteractionManager.createRecoveredInteraction,
    ).toHaveBeenCalledTimes(2)
    expect(mockPendingDictationStore.delete).toHaveBeenCalledTimes(2)
  })

  test('flushPendingDictations stops on transient failure and keeps files', async () => {
    const { LocalTranscriptionError } = await import(
      './transcription/LocalTranscriptionService'
    )
    mockPendingDictationStore.list.mockReturnValue(['C:/pending/a.wav'])
    mockLocalTranscriptionService.transcribeAudio.mockRejectedValue(
      Object.assign(new (LocalTranscriptionError as any)('offline'), {
        code: 'NETWORK',
      }),
    )

    const { ItoStreamController } = await import('./itoStreamController')
    const controller = new ItoStreamController()

    const recovered = await controller.flushPendingDictations()

    expect(recovered).toBe(0)
    expect(mockPendingDictationStore.delete).not.toHaveBeenCalled()
    expect(
      mockInteractionManager.createRecoveredInteraction,
    ).not.toHaveBeenCalled()
  })
})
