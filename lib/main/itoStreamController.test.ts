import { describe, test, expect, mock, beforeEach } from 'bun:test'

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
  complete: mock(() => Promise.resolve('adjusted transcript')),
}
mock.module('./transcription/LocalTranscriptionService', () => ({
  localTranscriptionService: mockLocalTranscriptionService,
  LocalTranscriptionError: class extends Error {},
}))

const mockTranscriptAdjuster = {
  adjust: mock(() => Promise.resolve('adjusted transcript')),
}
mock.module('./transcription/TranscriptAdjuster', () => ({
  transcriptAdjuster: mockTranscriptAdjuster,
}))

const mockOpenRouterService = {
  transcribeAudio: mock(() => Promise.resolve('openrouter transcript')),
  testConnection: mock(() => Promise.resolve({ ok: true })),
}
mock.module('./transcription/OpenRouterTranscriptionService', () => ({
  openRouterTranscriptionService: mockOpenRouterService,
}))

const mockOpenRouterHealth = {
  getRejectedKeyFailure: mock((): any => null),
  recordOpenRouterFailure: mock(() => {}),
  clearOpenRouterFailure: mock(() => {}),
  failureNotice: mock(() => 'notice'),
}
mock.module('./transcription/openRouterHealth', () => mockOpenRouterHealth)

const baseAdvancedSettings = () => ({
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
})

const mockGetAdvancedSettings = mock(() => baseAdvancedSettings() as any)

const testMode = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 'intelligent',
    userId: 'self-hosted',
    name: 'Intelligent',
    preset: 'intelligent',
    icon: 'Sparkles',
    instructions: '## Role\nFormat.',
    language: 'fr',
    voiceModelKey: 'whisper-large-v3-turbo',
    textModelKey: 'gpt-5-6-luna',
    useLlm: true,
    contextApplication: false,
    contextClipboard: false,
    contextSelection: false,
    audioSource: 'microphone',
    playbackWhenRecording: 'mute',
    autoPaste: true,
    autocapitalize: true,
    identifySpeakers: false,
    asrPrompt: '',
    sortOrder: 0,
    createdAt: '2026-08-14T00:00:00.000Z',
    updatedAt: '2026-08-14T00:00:00.000Z',
    ...overrides,
  }) as any

mock.module('./modes/activeMode', () => ({
  resolveActiveMode: async () => testMode(),
  resolveMode: async () => testMode(),
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

    Object.values(mockOpenRouterService).forEach(fn => fn.mockClear())
    Object.values(mockOpenRouterHealth).forEach(fn => fn.mockClear())
    mockOpenRouterHealth.getRejectedKeyFailure.mockReturnValue(null)
    mockGetAdvancedSettings.mockClear()

    mockAudioStreamManager.isCurrentlyStreaming.mockReturnValue(false)
    mockLocalTranscriptionService.transcribeAudio.mockResolvedValue(
      'raw transcript',
    )
    mockOpenRouterService.transcribeAudio.mockResolvedValue(
      'openrouter transcript',
    )
    mockPendingDictationStore.save.mockReturnValue('C:/pending/dictation-1.wav')
    mockPendingDictationStore.list.mockReturnValue([])
    mockLocalAudioProcessor.prepareAudioForTranscription.mockReturnValue({
      wavAudio: Buffer.from('wav'),
      sampleRate: 16000,
      durationMs: 500,
    })
    mockGetAdvancedSettings.mockReturnValue(baseAdvancedSettings())
  })

  test('initializes and processes audio locally', async () => {
    const { ItoStreamController } = await import('./itoStreamController')
    const controller = new ItoStreamController()

    await controller.initialize(testMode())
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

    await controller.initialize(testMode())
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

    await controller.initialize(testMode())
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

    await controller.initialize(testMode())
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

    await controller.initialize(testMode())
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

  describe('engine routing (the mode names the provider)', () => {
    const longAudio = () =>
      mockLocalAudioProcessor.prepareAudioForTranscription.mockReturnValue({
        wavAudio: Buffer.from('wav'),
        sampleRate: 16000,
        durationMs: 120_000,
      })

    const openRouterMode = (overrides: Record<string, unknown> = {}) =>
      testMode({ voiceModelKey: 'gpt-transcribe', ...overrides })

    const withOpenRouter = (overrides: Record<string, unknown> = {}) =>
      mockGetAdvancedSettings.mockReturnValue({
        ...baseAdvancedSettings(),
        openRouterApiKey: 'sk-or-test',
        ...overrides,
      } as any)

    test('routes an OpenRouter voice model to OpenRouter', async () => {
      longAudio()
      withOpenRouter()

      const { ItoStreamController } = await import('./itoStreamController')
      const controller = new ItoStreamController()
      await controller.initialize(openRouterMode())
      const result = await controller.processLocalTranscription()

      expect(mockOpenRouterService.transcribeAudio).toHaveBeenCalledTimes(1)
      expect(mockOpenRouterService.transcribeAudio).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.objectContaining({
          apiKey: 'sk-or-test',
          model: 'openai/gpt-transcribe',
        }),
      )
      expect(
        mockLocalTranscriptionService.transcribeAudio,
      ).not.toHaveBeenCalled()
      expect(result.transcript).toBe('adjusted transcript')
    })

    test('a Groq voice model never reaches OpenRouter', async () => {
      longAudio()
      withOpenRouter()

      const { ItoStreamController } = await import('./itoStreamController')
      const controller = new ItoStreamController()
      await controller.initialize(testMode())
      await controller.processLocalTranscription()

      expect(mockOpenRouterService.transcribeAudio).not.toHaveBeenCalled()
      expect(mockLocalTranscriptionService.transcribeAudio).toHaveBeenCalled()
    })

    test('the voice model of the mode decides the provider, whatever the duration', async () => {
      withOpenRouter()

      const { ItoStreamController } = await import('./itoStreamController')
      const controller = new ItoStreamController()

      await controller.initialize(openRouterMode())
      await controller.processLocalTranscription()

      expect(mockOpenRouterService.transcribeAudio).toHaveBeenCalledTimes(1)
      expect(
        mockLocalTranscriptionService.transcribeAudio,
      ).not.toHaveBeenCalled()
    })

    test('falls back to Groq when the OpenRouter call fails', async () => {
      longAudio()
      withOpenRouter()
      mockOpenRouterService.transcribeAudio.mockRejectedValue(
        Object.assign(new Error('empty transcript'), { code: 'MODEL_ERROR' }),
      )

      const { ItoStreamController } = await import('./itoStreamController')
      const controller = new ItoStreamController()
      await controller.initialize(openRouterMode())
      const result = await controller.processLocalTranscription()

      expect(mockOpenRouterService.transcribeAudio).toHaveBeenCalledTimes(1)
      expect(mockLocalTranscriptionService.transcribeAudio).toHaveBeenCalled()
      expect(result.transcript).toBe('adjusted transcript')
      expect(mockPendingDictationStore.delete).toHaveBeenCalled()
    })

    test('records why the fallback happened, on the result and in the settings', async () => {
      longAudio()
      withOpenRouter()
      mockOpenRouterService.transcribeAudio.mockRejectedValue(
        Object.assign(new Error('OpenRouter rejected the API key'), {
          code: 'INVALID_API_KEY',
        }),
      )

      const { ItoStreamController } = await import('./itoStreamController')
      const controller = new ItoStreamController()
      await controller.initialize(openRouterMode())
      const result = await controller.processLocalTranscription()

      expect(result.asrFallback).toEqual({
        from: 'openai/gpt-transcribe',
        code: 'INVALID_API_KEY',
        message: 'OpenRouter rejected the API key',
      })
      expect(mockOpenRouterHealth.recordOpenRouterFailure).toHaveBeenCalledWith(
        {
          code: 'INVALID_API_KEY',
          message: 'OpenRouter rejected the API key',
          model: 'openai/gpt-transcribe',
          apiKey: 'sk-or-test',
        },
      )
    })

    test('a successful call clears any recorded failure', async () => {
      longAudio()
      withOpenRouter()

      const { ItoStreamController } = await import('./itoStreamController')
      const controller = new ItoStreamController()
      await controller.initialize(openRouterMode())
      const result = await controller.processLocalTranscription()

      expect(mockOpenRouterHealth.clearOpenRouterFailure).toHaveBeenCalled()
      expect(result.asrFallback).toBeUndefined()
    })

    test('retries a transient OpenRouter failure once before falling back', async () => {
      const { LocalTranscriptionError } = await import(
        './transcription/LocalTranscriptionService'
      )
      longAudio()
      withOpenRouter()
      mockOpenRouterService.transcribeAudio.mockRejectedValue(
        Object.assign(new (LocalTranscriptionError as any)('offline'), {
          code: 'NETWORK',
          retryAfterMs: 0,
        }),
      )

      const { ItoStreamController } = await import('./itoStreamController')
      const controller = new ItoStreamController()
      await controller.initialize(openRouterMode())
      await controller.processLocalTranscription()

      expect(mockOpenRouterService.transcribeAudio).toHaveBeenCalledTimes(2)
      expect(mockLocalTranscriptionService.transcribeAudio).toHaveBeenCalled()
    })

    test('does not retry a refused key', async () => {
      const { LocalTranscriptionError } = await import(
        './transcription/LocalTranscriptionService'
      )
      longAudio()
      withOpenRouter()
      mockOpenRouterService.transcribeAudio.mockRejectedValue(
        Object.assign(new (LocalTranscriptionError as any)('refused'), {
          code: 'INVALID_API_KEY',
        }),
      )

      const { ItoStreamController } = await import('./itoStreamController')
      const controller = new ItoStreamController()
      await controller.initialize(openRouterMode())
      await controller.processLocalTranscription()

      expect(mockOpenRouterService.transcribeAudio).toHaveBeenCalledTimes(1)
    })

    test('a key already known to be refused skips the upload entirely', async () => {
      longAudio()
      withOpenRouter()
      mockOpenRouterHealth.getRejectedKeyFailure.mockReturnValue({
        code: 'INVALID_API_KEY',
        message: 'OpenRouter rejected the API key',
        model: 'openai/gpt-transcribe',
        at: '2026-08-14T17:40:25.431Z',
        keyFingerprint: 'abc123',
      })

      const { ItoStreamController } = await import('./itoStreamController')
      const controller = new ItoStreamController()
      await controller.initialize(openRouterMode())
      const result = await controller.processLocalTranscription()

      expect(mockOpenRouterService.transcribeAudio).not.toHaveBeenCalled()
      expect(mockLocalTranscriptionService.transcribeAudio).toHaveBeenCalled()
      // The downgrade is still on the record, otherwise the history row would
      // be indistinguishable from a dictation that was meant to run on Groq.
      expect(result.asrFallback?.code).toBe('INVALID_API_KEY')
    })

    test('an OpenRouter model without a key falls back to Groq rather than failing', async () => {
      longAudio()
      withOpenRouter({ openRouterApiKey: '' })

      const { ItoStreamController } = await import('./itoStreamController')
      const controller = new ItoStreamController()
      await controller.initialize(openRouterMode())
      await controller.processLocalTranscription()

      expect(mockOpenRouterService.transcribeAudio).not.toHaveBeenCalled()
      expect(mockLocalTranscriptionService.transcribeAudio).toHaveBeenCalled()
    })
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
