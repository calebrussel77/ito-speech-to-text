import { describe, test, expect, mock, beforeEach } from 'bun:test'
import {
  FILE_PATH_THRESHOLD_MS,
  GROQ_MAX_BYTES,
} from './transcription/transcriptionRouter'

// The base electron mock (lib/__tests__/setup.ts) never marks Notification
// as supported, so `showNotification` silently no-ops there — none of the
// French copy it produces is ever observable from a test. Re-registering the
// 'electron' mock here (same shape, Notification swapped for a spy) lets the
// tests below confirm not just that a code path was taken, but the exact
// message the user would see. `import { Notification } from 'electron'` is a
// live binding onto the exports object Bun hands back from this factory —
// not writable from outside — so the spy has to be baked in at registration
// time rather than assigned onto the imported binding afterwards.
type NotificationCall = { title: string; body: string }
let notificationCalls: NotificationCall[] = []

class SpyNotification {
  static isSupported() {
    return true
  }
  private opts: NotificationCall
  constructor(opts: NotificationCall) {
    this.opts = opts
  }
  show() {
    notificationCalls.push(this.opts)
  }
}

mock.module('electron', () => {
  let userDataPath = '/tmp/test-ito-app'
  let appName = 'Ito'
  return {
    app: {
      getPath: (type: string) => {
        if (type === 'userData') return userDataPath
        return '/tmp/test-path'
      },
      setPath: (type: string, newPath: string) => {
        if (type === 'userData') userDataPath = newPath
      },
      quit: () => {},
      on: () => {},
      getName: () => appName,
      setName: (name: string) => {
        appName = name
      },
      getVersion: () => '1.0.0',
      whenReady: () => Promise.resolve(),
      isReady: () => true,
      isPackaged: false,
      dock: {
        hide: () => {},
        show: () => {},
      },
    },
    BrowserWindow: class MockBrowserWindow {
      webContents: any

      constructor() {
        this.webContents = {
          send: () => {},
          on: () => {},
          openDevTools: () => {},
        }
      }

      static getAllWindows() {
        return []
      }
      loadURL() {}
      loadFile() {}
      on() {}
      once() {}
      show() {}
      hide() {}
      close() {}
      destroy() {}
      minimize() {}
      maximize() {}
      restore() {}
      focus() {}
      blur() {}
      isFocused() {
        return true
      }
      isVisible() {
        return true
      }
      isMinimized() {
        return false
      }
      isMaximized() {
        return false
      }
      setTitle() {}
      getTitle() {
        return 'Test Window'
      }
    },
    shell: {
      openExternal: () => {},
      showItemInFolder: () => {},
      openPath: () => {},
    },
    screen: {
      getPrimaryDisplay: () => ({
        workAreaSize: { width: 1920, height: 1080 },
        size: { width: 1920, height: 1080 },
      }),
      getAllDisplays: () => [],
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
    },
    protocol: {
      registerSchemesAsPrivileged: () => {},
      registerFileProtocol: () => {},
      registerHttpProtocol: () => {},
      registerBufferProtocol: () => {},
      registerStringProtocol: () => {},
      unregisterProtocol: () => {},
    },
    net: {
      request: () => {},
    },
    ipcMain: {
      on: () => {},
      once: () => {},
      handle: () => {},
      handleOnce: () => {},
      removeAllListeners: () => {},
      removeHandler: () => {},
    },
    ipcRenderer: {
      invoke: () => {},
      send: () => {},
      on: () => {},
      once: () => {},
      removeAllListeners: () => {},
      removeListener: () => {},
      sendSync: (channel: string) => {
        if (channel === 'electron-store-get-data') {
          return {
            encryptionKey: null,
            migrations: {},
            projectVersion: '1.0.0',
            projectSuffix: 'test',
            defaults: {},
            name: 'config',
            builtinMigrations: false,
            clearInvalidConfig: false,
            serialize: null,
            deserialize: null,
            appVersion: '1.0.0',
            path: '/tmp/test-config.json',
          }
        }
        return null
      },
    },
    contextBridge: {
      exposeInMainWorld: () => {},
    },
    systemPreferences: {
      askForMediaAccess: () => {},
      getMediaAccessStatus: () => 'granted',
      getAnimationSettings: () => ({ shouldRenderRichAnimation: true }),
    },
    powerSaveBlocker: {
      start: () => 1,
      stop: () => {},
      isStarted: () => false,
    },
    Menu: class MockMenu {},
    MenuItem: class MockMenuItem {},
    Tray: class MockTray {},
    Notification: SpyNotification,
    dialog: {
      showOpenDialog: () => {},
      showSaveDialog: () => {},
      showMessageBox: () => {},
      showErrorBox: () => {},
    },
    clipboard: {
      writeText: () => {},
      readText: () => '',
    },
    nativeTheme: {
      shouldUseDarkColors: false,
      on: () => {},
    },
    IpcRendererEvent: class MockIpcRendererEvent {},
    IpcMainEvent: class MockIpcMainEvent {},
    autoUpdater: {
      quitAndInstall: () => {},
    },
    powerMonitor: {
      on: () => {},
      getSystemIdleState: () => 'active',
      getSystemIdleTime: () => 0,
    },
    crashReporter: {
      start: () => {},
      getLastCrashReport: () => null,
      getUploadedReports: () => [],
      getUploadToServer: () => true,
      setUploadToServer: () => {},
    },
    nativeImage: {
      createEmpty: () => ({}),
      createFromPath: () => ({}),
      createFromBuffer: () => ({}),
      createFromDataURL: () => ({}),
    },
  }
})

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
  getWavDurationMs: mock((): number | null => null),
}
mock.module('./transcription/LocalAudioProcessor', () => ({
  localAudioProcessor: mockLocalAudioProcessor,
}))

const mockPendingDictationStore = {
  save: mock(() => 'C:/pending/dictation-1.wav'),
  saveAsync: mock(() => Promise.resolve('C:/pending/dictation-1.wav')),
  delete: mock(),
  read: mock(() => Buffer.from('wav')),
  readMeta: mock((): any => null),
  writeMeta: mock(),
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
  getVocabulary: mock(
    (): Promise<{ vocabularyWords: string[]; dictionaryEntries: string[] }> =>
      Promise.resolve({ vocabularyWords: [], dictionaryEntries: [] }),
  ),
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
  // A real LocalTranscriptionError carries `code` from its constructor (the
  // router's `decision.path === null` throw relies on that); other tests in
  // this file build one with a single arg then attach `code` via
  // Object.assign, which still works since the field is just overwritten.
  LocalTranscriptionError: class extends Error {
    code?: string
    constructor(message: string, code?: string) {
      super(message)
      this.code = code
    }
  },
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

const mockProviderHealth = {
  getRejectedKeyFailure: mock((): any => null),
  recordProviderFailure: mock(() => {}),
  clearProviderFailure: mock(() => {}),
  failureNotice: mock(() => 'notice'),
}
mock.module('./transcription/providerHealth', () => mockProviderHealth)

const mockDeepgramService = {
  transcribeAudio: mock(
    (): Promise<{ text: string; segments: any[] }> =>
      Promise.resolve({ text: 'deepgram transcript', segments: [] }),
  ),
}
mock.module('./transcription/DeepgramTranscriptionService', () => ({
  deepgramTranscriptionService: mockDeepgramService,
}))

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

const mockResolveModeOrActive = mock(async (_modeId?: string) => testMode())
mock.module('./modes/activeMode', () => ({
  resolveActiveMode: async () => testMode(),
  resolveMode: async () => testMode(),
  resolveModeOrActive: mockResolveModeOrActive,
}))

const mockCreateNewAuthState = mock(() => ({
  state: '',
  codeVerifier: '',
  codeChallenge: '',
  codeChallengeMethod: 'S256',
  createdAt: new Date().toISOString(),
}))
const mockGetCurrentUserId = mock(() => 'self-hosted')

// `notifications` and `recordingStateNotifier` both reach `./app`, whose
// `icon.png?asset` import only the electron-vite bundler understands. Neither
// window matters here.
mock.module('./app', () => ({
  getPillWindow: () => null,
  mainWindow: null,
  setPillBusy: () => {},
}))

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
    notificationCalls = []

    Object.values(mockAudioStreamManager).forEach(fn => fn.mockClear())
    Object.values(mockLocalAudioProcessor).forEach(fn => fn.mockClear())
    Object.values(mockContextGrabber).forEach(fn => fn.mockClear())
    Object.values(mockLocalTranscriptionService).forEach(fn => fn.mockClear())
    Object.values(mockPendingDictationStore).forEach(fn => fn.mockClear())
    Object.values(mockInteractionManager).forEach(fn => fn.mockClear())

    Object.values(mockOpenRouterService).forEach(fn => fn.mockClear())
    Object.values(mockProviderHealth).forEach(fn => fn.mockClear())
    Object.values(mockDeepgramService).forEach(fn => fn.mockClear())
    mockProviderHealth.getRejectedKeyFailure.mockReturnValue(null)
    mockGetAdvancedSettings.mockClear()

    mockAudioStreamManager.isCurrentlyStreaming.mockReturnValue(false)
    mockLocalTranscriptionService.transcribeAudio.mockResolvedValue(
      'raw transcript',
    )
    mockOpenRouterService.transcribeAudio.mockResolvedValue(
      'openrouter transcript',
    )
    mockDeepgramService.transcribeAudio.mockResolvedValue({
      text: 'deepgram transcript',
      segments: [],
    })
    mockPendingDictationStore.save.mockReturnValue('C:/pending/dictation-1.wav')
    mockPendingDictationStore.saveAsync.mockResolvedValue(
      'C:/pending/dictation-1.wav',
    )
    mockPendingDictationStore.list.mockReturnValue([])
    mockPendingDictationStore.readMeta.mockReturnValue(null)
    mockResolveModeOrActive.mockClear()
    mockResolveModeOrActive.mockImplementation(async () => testMode())
    mockTranscriptAdjuster.adjust.mockClear()
    mockTranscriptAdjuster.adjust.mockResolvedValue('adjusted transcript')
    mockPendingDictationStore.read.mockReturnValue(Buffer.from('wav'))
    mockLocalAudioProcessor.prepareAudioForTranscription.mockReturnValue({
      wavAudio: Buffer.from('wav'),
      sampleRate: 16000,
      durationMs: 500,
    })
    mockLocalAudioProcessor.getWavDurationMs.mockReturnValue(null)
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

    // Written in the background (never on the main thread), deleted once
    // the transcript is in hand.
    expect(mockPendingDictationStore.saveAsync).toHaveBeenCalled()
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

  describe('engine routing (the mode and the recording decide the transport)', () => {
    // Well under FILE_PATH_THRESHOLD_MS (8 min): stays on the short-body
    // transports (Groq/OpenRouter), never on Deepgram's file path.
    const longAudio = () =>
      mockLocalAudioProcessor.prepareAudioForTranscription.mockReturnValue({
        wavAudio: Buffer.from('wav'),
        sampleRate: 16000,
        durationMs: 120_000,
      })

    // At/past FILE_PATH_THRESHOLD_MS: only the Deepgram file path accepts it.
    const veryLongAudio = () =>
      mockLocalAudioProcessor.prepareAudioForTranscription.mockReturnValue({
        wavAudio: Buffer.from('wav'),
        sampleRate: 16000,
        durationMs: FILE_PATH_THRESHOLD_MS,
      })

    // Past the file-path threshold and too big for Groq's 25 MB ceiling too:
    // nothing short of Deepgram can carry it.
    const tooBigForGroqAudio = () =>
      mockLocalAudioProcessor.prepareAudioForTranscription.mockReturnValue({
        wavAudio: Buffer.alloc(GROQ_MAX_BYTES + 1),
        sampleRate: 16000,
        durationMs: FILE_PATH_THRESHOLD_MS,
      })

    const openRouterMode = (overrides: Record<string, unknown> = {}) =>
      testMode({ voiceModelKey: 'gpt-transcribe', ...overrides })

    const withOpenRouter = (overrides: Record<string, unknown> = {}) =>
      mockGetAdvancedSettings.mockReturnValue({
        ...baseAdvancedSettings(),
        openRouterApiKey: 'sk-or-test',
        ...overrides,
      } as any)

    const withDeepgram = (overrides: Record<string, unknown> = {}) =>
      mockGetAdvancedSettings.mockReturnValue({
        ...baseAdvancedSettings(),
        deepgramApiKey: 'dg-test',
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

    test('under the file-path threshold, the voice model of the mode decides the provider', async () => {
      withOpenRouter()

      const { ItoStreamController } = await import('./itoStreamController')
      const controller = new ItoStreamController()

      await controller.initialize(openRouterMode())
      await controller.processLocalTranscription()

      expect(mockOpenRouterService.transcribeAudio).toHaveBeenCalledTimes(1)
      expect(
        mockLocalTranscriptionService.transcribeAudio,
      ).not.toHaveBeenCalled()
      expect(mockDeepgramService.transcribeAudio).not.toHaveBeenCalled()
    })

    test('past the file-path threshold, an OpenRouter voice model routes to Deepgram instead', async () => {
      veryLongAudio()
      withOpenRouter()
      withDeepgram({ openRouterApiKey: 'sk-or-test' })

      const { ItoStreamController } = await import('./itoStreamController')
      const controller = new ItoStreamController()
      await controller.initialize(openRouterMode())
      const result = await controller.processLocalTranscription()

      expect(mockDeepgramService.transcribeAudio).toHaveBeenCalledTimes(1)
      expect(mockDeepgramService.transcribeAudio).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.objectContaining({ apiKey: 'dg-test', model: 'nova-3' }),
      )
      expect(mockOpenRouterService.transcribeAudio).not.toHaveBeenCalled()
      expect(
        mockLocalTranscriptionService.transcribeAudio,
      ).not.toHaveBeenCalled()
      expect(result.asrEngine).toBe('deepgram/nova-3')
      expect(result.transcript).toBe('adjusted transcript')
    })

    test('a mode that identifies speakers routes to Deepgram even on a short recording', async () => {
      withDeepgram()
      mockDeepgramService.transcribeAudio.mockResolvedValue({
        text: 'deepgram transcript',
        segments: [
          {
            speaker: 0,
            label: 'Speaker 1',
            startMs: 0,
            endMs: 100,
            text: 'hi',
          },
        ],
      })

      const { ItoStreamController } = await import('./itoStreamController')
      const controller = new ItoStreamController()
      await controller.initialize(testMode({ identifySpeakers: true }))
      const result = await controller.processLocalTranscription()

      expect(mockDeepgramService.transcribeAudio).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.objectContaining({ diarize: true }),
      )
      expect(result.speakerSegments).toHaveLength(1)
    })

    test('a Deepgram failure falls back to Groq and records why', async () => {
      veryLongAudio()
      withDeepgram()
      mockDeepgramService.transcribeAudio.mockRejectedValue(
        Object.assign(new Error('Deepgram rejected the API key'), {
          code: 'INVALID_API_KEY',
        }),
      )

      const { ItoStreamController } = await import('./itoStreamController')
      const controller = new ItoStreamController()
      await controller.initialize(testMode())
      const result = await controller.processLocalTranscription()

      expect(mockDeepgramService.transcribeAudio).toHaveBeenCalledTimes(1)
      expect(mockLocalTranscriptionService.transcribeAudio).toHaveBeenCalled()
      expect(result.asrFallback).toEqual({
        from: 'deepgram/nova-3',
        code: 'INVALID_API_KEY',
        message: 'Deepgram rejected the API key',
      })
      expect(mockPendingDictationStore.delete).toHaveBeenCalled()
      expect(mockProviderHealth.recordProviderFailure).toHaveBeenCalledWith({
        provider: 'deepgram',
        code: 'INVALID_API_KEY',
        message: 'Deepgram rejected the API key',
        model: 'deepgram/nova-3',
        apiKey: 'dg-test',
      })
    })

    test('a successful Deepgram call clears any recorded failure', async () => {
      veryLongAudio()
      withDeepgram()

      const { ItoStreamController } = await import('./itoStreamController')
      const controller = new ItoStreamController()
      await controller.initialize(testMode())
      const result = await controller.processLocalTranscription()

      expect(mockProviderHealth.clearProviderFailure).toHaveBeenCalledWith(
        'deepgram',
      )
      expect(result.asrFallback).toBeUndefined()
    })

    test('a Deepgram key already known to be refused skips the upload entirely', async () => {
      veryLongAudio()
      withDeepgram()
      mockProviderHealth.getRejectedKeyFailure.mockReturnValue({
        code: 'INVALID_API_KEY',
        message: 'Deepgram rejected the API key',
        model: 'deepgram/nova-3',
        at: '2026-08-14T17:40:25.431Z',
        keyFingerprint: 'abc123',
      })

      const { ItoStreamController } = await import('./itoStreamController')
      const controller = new ItoStreamController()
      await controller.initialize(testMode())
      const result = await controller.processLocalTranscription()

      expect(mockDeepgramService.transcribeAudio).not.toHaveBeenCalled()
      expect(mockLocalTranscriptionService.transcribeAudio).toHaveBeenCalled()
      // The downgrade is still on the record, otherwise the history row would
      // be indistinguishable from a dictation that was meant to run on Groq.
      expect(result.asrFallback?.code).toBe('INVALID_API_KEY')
    })

    test('a long recording without a Deepgram key still reaches Groq, not OpenRouter', async () => {
      veryLongAudio()
      withOpenRouter()

      const { ItoStreamController } = await import('./itoStreamController')
      const controller = new ItoStreamController()
      await controller.initialize(openRouterMode())
      const result = await controller.processLocalTranscription()

      expect(mockDeepgramService.transcribeAudio).not.toHaveBeenCalled()
      expect(mockOpenRouterService.transcribeAudio).not.toHaveBeenCalled()
      expect(mockLocalTranscriptionService.transcribeAudio).toHaveBeenCalled()
      expect(result.transcript).toBe('adjusted transcript')
    })

    test('a recording too big for Groq with no Deepgram key is refused by name, WAV kept', async () => {
      tooBigForGroqAudio()
      withOpenRouter()

      const { ItoStreamController } = await import('./itoStreamController')
      const controller = new ItoStreamController()
      await controller.initialize(openRouterMode())

      let caught: any
      try {
        await controller.processLocalTranscription()
      } catch (error) {
        caught = error
      }

      expect(caught).toMatchObject({ code: 'MODEL_ERROR' })

      expect(mockDeepgramService.transcribeAudio).not.toHaveBeenCalled()
      expect(mockOpenRouterService.transcribeAudio).not.toHaveBeenCalled()
      expect(
        mockLocalTranscriptionService.transcribeAudio,
      ).not.toHaveBeenCalled()
      // Named error, but the dictation is never lost: it stays on disk.
      expect(mockPendingDictationStore.delete).not.toHaveBeenCalled()

      // This refusal must get the exact same treatment as every other
      // recoverable failure in the file: the WAV linked, the duration
      // carried, and the user told — otherwise the history row reads as an
      // unexplained "Failed dictation" instead of one awaiting retry, and
      // `findPendingInteraction` has nothing to reconcile later.
      expect(caught.pendingDictationPath).toBe('C:/pending/dictation-1.wav')
      expect(caught.audioDurationMs).toBe(FILE_PATH_THRESHOLD_MS)
      expect(notificationCalls).toContainEqual({
        title: 'Ito — dictée sauvegardée',
        body: 'La transcription a échoué. Votre dictée sera récupérée automatiquement dans l’historique.',
      })
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
      expect(mockProviderHealth.recordProviderFailure).toHaveBeenCalledWith({
        provider: 'openrouter',
        code: 'INVALID_API_KEY',
        message: 'OpenRouter rejected the API key',
        model: 'openai/gpt-transcribe',
        apiKey: 'sk-or-test',
      })
    })

    test('a successful call clears any recorded failure', async () => {
      longAudio()
      withOpenRouter()

      const { ItoStreamController } = await import('./itoStreamController')
      const controller = new ItoStreamController()
      await controller.initialize(openRouterMode())
      const result = await controller.processLocalTranscription()

      expect(mockProviderHealth.clearProviderFailure).toHaveBeenCalledWith(
        'openrouter',
      )
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
      mockProviderHealth.getRejectedKeyFailure.mockReturnValue({
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

  describe('latency: the engine upload never waits for the context capture', () => {
    test('the ASR call starts before gatherContext resolves, and the LLM rewrite waits for it', async () => {
      let releaseContext: (value: any) => void = () => {}
      const contextOrder: string[] = []
      mockContextGrabber.gatherContext.mockImplementation(
        () =>
          new Promise(resolve => {
            releaseContext = (value: any) => {
              contextOrder.push('context')
              resolve(value)
            }
          }),
      )
      mockLocalTranscriptionService.transcribeAudio.mockImplementation(
        async () => {
          contextOrder.push('asr')
          return 'raw transcript'
        },
      )

      const { ItoStreamController } = await import('./itoStreamController')
      const controller = new ItoStreamController()
      await controller.initialize(testMode())

      const pending = controller.processLocalTranscription()
      // Let the ASR fire while the context is still being captured.
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(contextOrder).toEqual(['asr'])
      expect(mockTranscriptAdjuster.adjust).not.toHaveBeenCalled()

      releaseContext({
        windowTitle: 'Late',
        appName: 'App',
        contextText: '',
        clipboardText: '',
        vocabularyWords: [],
        dictionaryEntries: [],
        advancedSettings: baseAdvancedSettings(),
      })
      const result = await pending
      // `mockClear` in beforeEach keeps implementations: restore the default
      // context so the next tests are not left waiting on `releaseContext`.
      mockContextGrabber.gatherContext.mockImplementation(() =>
        Promise.resolve({
          windowTitle: 'Win',
          appName: 'App',
          contextText: 'Ctx',
          clipboardText: '',
          vocabularyWords: [],
          dictionaryEntries: [],
          advancedSettings: baseAdvancedSettings(),
        } as any),
      )

      expect(contextOrder).toEqual(['asr', 'context'])
      expect(mockTranscriptAdjuster.adjust).toHaveBeenCalledWith(
        'raw transcript',
        expect.anything(),
        expect.objectContaining({ windowTitle: 'Late' }),
        expect.anything(),
      )
      expect(result.latency).toEqual(
        expect.objectContaining({
          prepareMs: expect.any(Number),
          asrMs: expect.any(Number),
          adjustMs: expect.any(Number),
        }),
      )
    })

    test('a transcript that is only a known hallucination is rejected as NO_SPEECH and its WAV dropped', async () => {
      mockLocalTranscriptionService.transcribeAudio.mockResolvedValue(
        "Sous-titres réalisés par la communauté d'Amara.org",
      )
      const { ItoStreamController } = await import('./itoStreamController')
      const controller = new ItoStreamController()
      await controller.initialize(testMode())

      await expect(
        controller.processLocalTranscription(),
      ).rejects.toMatchObject({ code: 'NO_SPEECH' })
      expect(mockPendingDictationStore.delete).toHaveBeenCalledWith(
        'C:/pending/dictation-1.wav',
      )
    })

    test('a phrase the engine looped is collapsed before the dictionary pass', async () => {
      mockLocalTranscriptionService.transcribeAudio.mockResolvedValue(
        'je pense que oui je pense que oui je pense que oui je pense que oui',
      )
      const { ItoStreamController } = await import('./itoStreamController')
      const controller = new ItoStreamController()
      await controller.initialize(testMode())

      const result = await controller.processLocalTranscription()
      expect(result.rawTranscript).toBe('je pense que oui')
    })
  })

  describe('flushPendingDictations replays the original dictation, not a degraded one', () => {
    const savedMeta = () => ({
      modeId: 'email',
      modeName: 'Email',
      durationMs: 5_000,
      context: {
        vocabularyWords: ['Ito'],
        dictionaryEntries: ['Ito'],
        windowTitle: 'Inbox',
        appName: 'Mail',
        contextText: 'Hi team',
        clipboardText: '',
      },
    })

    test('a live dictation writes its mode and context next to the WAV', async () => {
      const { ItoStreamController } = await import('./itoStreamController')
      const controller = new ItoStreamController()

      await controller.initialize(testMode({ id: 'email', name: 'Email' }))
      await controller.processLocalTranscription()

      expect(mockPendingDictationStore.writeMeta).toHaveBeenCalledWith(
        'C:/pending/dictation-1.wav',
        expect.objectContaining({
          modeId: 'email',
          modeName: 'Email',
          durationMs: 500,
          context: expect.objectContaining({ windowTitle: 'Win' }),
        }),
      )
    })

    test('the recovery pass uses the recorded mode, its saved context and the mode rewrite', async () => {
      mockPendingDictationStore.list.mockReturnValue(['C:/pending/a.wav'])
      mockPendingDictationStore.readMeta.mockReturnValue(savedMeta())
      const emailMode = testMode({ id: 'email', name: 'Email', useLlm: true })
      mockResolveModeOrActive.mockImplementation(async () => emailMode)

      const { ItoStreamController } = await import('./itoStreamController')
      const controller = new ItoStreamController()

      const recovered = await controller.flushPendingDictations()

      expect(recovered).toBe(1)
      expect(mockResolveModeOrActive).toHaveBeenCalledWith('email')
      // The saved vocabulary primes the engine, as it did live.
      expect(
        mockLocalTranscriptionService.transcribeAudio,
      ).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.objectContaining({ vocabulary: ['Ito'] }),
      )
      // The mode's rewrite runs on the raw transcript with the saved context.
      expect(mockTranscriptAdjuster.adjust).toHaveBeenCalledWith(
        'raw transcript',
        emailMode,
        expect.objectContaining({
          windowTitle: 'Inbox',
          contextText: 'Hi team',
        }),
        expect.anything(),
      )
      expect(
        mockInteractionManager.createRecoveredInteraction,
      ).toHaveBeenCalledWith(
        'adjusted transcript',
        16000,
        'C:/pending/a.wav',
        5_000,
        expect.any(String),
        expect.objectContaining({
          rawTranscript: 'raw transcript',
          modeId: 'email',
          modeName: 'Email',
        }),
      )
    })

    test('the recorded mode routes the recovery to its precise engine (OpenRouter), not Groq', async () => {
      mockPendingDictationStore.list.mockReturnValue(['C:/pending/a.wav'])
      mockPendingDictationStore.readMeta.mockReturnValue(savedMeta())
      mockResolveModeOrActive.mockImplementation(async () =>
        testMode({ voiceModelKey: 'gpt-transcribe' }),
      )
      mockGetAdvancedSettings.mockReturnValue({
        ...baseAdvancedSettings(),
        openRouterApiKey: 'or-test',
      } as any)

      const { ItoStreamController } = await import('./itoStreamController')
      const controller = new ItoStreamController()

      const recovered = await controller.flushPendingDictations()

      expect(recovered).toBe(1)
      expect(mockOpenRouterService.transcribeAudio).toHaveBeenCalledTimes(1)
      expect(
        mockLocalTranscriptionService.transcribeAudio,
      ).not.toHaveBeenCalled()
      expect(
        mockInteractionManager.createRecoveredInteraction,
      ).toHaveBeenCalledWith(
        'adjusted transcript',
        16000,
        'C:/pending/a.wav',
        5_000,
        'openai/gpt-transcribe',
        expect.objectContaining({ rawTranscript: 'openrouter transcript' }),
      )
    })

    test('a WAV from before sidecars falls back to the active mode and the current dictionary', async () => {
      mockPendingDictationStore.list.mockReturnValue(['C:/pending/old.wav'])
      mockPendingDictationStore.readMeta.mockReturnValue(null)
      mockContextGrabber.getVocabulary.mockResolvedValue({
        vocabularyWords: ['Caleb'],
        dictionaryEntries: ['Caleb'],
      })

      const { ItoStreamController } = await import('./itoStreamController')
      const controller = new ItoStreamController()

      const recovered = await controller.flushPendingDictations()

      expect(recovered).toBe(1)
      expect(mockResolveModeOrActive).toHaveBeenCalledWith(undefined)
      expect(mockContextGrabber.gatherContext).not.toHaveBeenCalled()
      expect(
        mockLocalTranscriptionService.transcribeAudio,
      ).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.objectContaining({ vocabulary: ['Caleb'] }),
      )
    })

    test('the recovery pass does not retry inside a single pass: one NETWORK failure stops it immediately', async () => {
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

      await controller.flushPendingDictations()

      expect(
        mockLocalTranscriptionService.transcribeAudio,
      ).toHaveBeenCalledTimes(1)
    })
  })

  describe('flushPendingDictations routing (the recovery pass must reach the file path too)', () => {
    // Too big for Groq's 25 MB ceiling: the only way `chooseTranscriptionPath`
    // accepts this WAV is through Deepgram's file path.
    const tooBigForGroqWav = () =>
      mockPendingDictationStore.read.mockReturnValue(
        Buffer.alloc(GROQ_MAX_BYTES + 1),
      )

    test('routes a recovered WAV that needs the file path through Deepgram once a key exists', async () => {
      mockPendingDictationStore.list.mockReturnValue(['C:/pending/big.wav'])
      tooBigForGroqWav()
      mockGetAdvancedSettings.mockReturnValue({
        ...baseAdvancedSettings(),
        deepgramApiKey: 'dg-test',
      } as any)

      const { ItoStreamController } = await import('./itoStreamController')
      const controller = new ItoStreamController()

      const recovered = await controller.flushPendingDictations()

      expect(recovered).toBe(1)
      expect(mockDeepgramService.transcribeAudio).toHaveBeenCalledTimes(1)
      expect(mockDeepgramService.transcribeAudio).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.objectContaining({ apiKey: 'dg-test', model: 'nova-3' }),
      )
      expect(
        mockLocalTranscriptionService.transcribeAudio,
      ).not.toHaveBeenCalled()
      // The recovered row goes through the mode's rewrite like a live
      // dictation, and keeps the raw engine output next to it.
      expect(
        mockInteractionManager.createRecoveredInteraction,
      ).toHaveBeenCalledWith(
        'adjusted transcript',
        16000,
        'C:/pending/big.wav',
        undefined,
        'deepgram/nova-3',
        expect.objectContaining({ rawTranscript: 'deepgram transcript' }),
      )
      expect(mockPendingDictationStore.delete).toHaveBeenCalledWith(
        'C:/pending/big.wav',
      )
    })

    test('leaves a WAV that still needs the file path in place when no Deepgram key exists', async () => {
      mockPendingDictationStore.list.mockReturnValue(['C:/pending/big.wav'])
      tooBigForGroqWav()
      // baseAdvancedSettings() carries no Deepgram key.

      const { ItoStreamController } = await import('./itoStreamController')
      const controller = new ItoStreamController()

      const recovered = await controller.flushPendingDictations()

      expect(recovered).toBe(0)
      expect(mockDeepgramService.transcribeAudio).not.toHaveBeenCalled()
      expect(
        mockLocalTranscriptionService.transcribeAudio,
      ).not.toHaveBeenCalled()
      // Not lost, not looped on: still on disk for the next pass.
      expect(mockPendingDictationStore.delete).not.toHaveBeenCalled()
      expect(
        mockInteractionManager.createRecoveredInteraction,
      ).not.toHaveBeenCalled()
    })

    // Regression coverage for the gap: `flushPendingDictations` used to pass
    // `durationMs: 0` for every recovered WAV, so a recording long enough to
    // trip FILE_PATH_THRESHOLD_MS but still small enough for Groq's byte
    // ceiling was silently sent to Groq forever — exactly the transport the
    // router says not to trust with audio that long.
    test('routes a recovered WAV whose duration crosses the threshold to Deepgram even though its bytes fit under Groq (the duration-triggered case)', async () => {
      mockPendingDictationStore.list.mockReturnValue(['C:/pending/long.wav'])
      // Bytes stay small (default mock read: Buffer.from('wav')), well under
      // the Groq ceiling — only the recovered duration should trigger the
      // file path here.
      mockLocalAudioProcessor.getWavDurationMs.mockReturnValue(
        FILE_PATH_THRESHOLD_MS,
      )
      mockGetAdvancedSettings.mockReturnValue({
        ...baseAdvancedSettings(),
        deepgramApiKey: 'dg-test',
      } as any)

      const { ItoStreamController } = await import('./itoStreamController')
      const controller = new ItoStreamController()

      const recovered = await controller.flushPendingDictations()

      expect(recovered).toBe(1)
      expect(mockDeepgramService.transcribeAudio).toHaveBeenCalledTimes(1)
      expect(
        mockLocalTranscriptionService.transcribeAudio,
      ).not.toHaveBeenCalled()
    })

    test('a short recovered WAV still routes to Groq', async () => {
      mockPendingDictationStore.list.mockReturnValue(['C:/pending/short.wav'])
      mockLocalAudioProcessor.getWavDurationMs.mockReturnValue(5_000)
      // A Deepgram key is present so this pins that a short recovered WAV
      // stays on Groq because of its duration, not merely because no key
      // was configured.
      mockGetAdvancedSettings.mockReturnValue({
        ...baseAdvancedSettings(),
        deepgramApiKey: 'dg-test',
      } as any)

      const { ItoStreamController } = await import('./itoStreamController')
      const controller = new ItoStreamController()

      const recovered = await controller.flushPendingDictations()

      expect(recovered).toBe(1)
      expect(
        mockLocalTranscriptionService.transcribeAudio,
      ).toHaveBeenCalledTimes(1)
      expect(mockDeepgramService.transcribeAudio).not.toHaveBeenCalled()
    })

    test('a truncated/unparseable recovered WAV does not throw and does not abort the remaining pending files', async () => {
      mockPendingDictationStore.list.mockReturnValue([
        'C:/pending/corrupt.wav',
        'C:/pending/normal.wav',
      ])
      // getWavDurationMs returns null for an unparseable header (its
      // contract — see LocalAudioProcessor.test.ts) rather than throwing;
      // this pins that the flush loop treats that the same as "unknown
      // duration" and keeps going instead of aborting on the next file.
      mockLocalAudioProcessor.getWavDurationMs
        .mockReturnValueOnce(null)
        .mockReturnValueOnce(5_000)

      const { ItoStreamController } = await import('./itoStreamController')
      const controller = new ItoStreamController()

      const recovered = await controller.flushPendingDictations()

      expect(recovered).toBe(2)
      expect(
        mockLocalTranscriptionService.transcribeAudio,
      ).toHaveBeenCalledTimes(2)
      expect(mockPendingDictationStore.delete).toHaveBeenCalledTimes(2)
    })
  })
})
