import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { createMockTimingCollector } from '../__tests__/setup'
import { TimingEventName } from './timing/TimingCollector'

const mockTimingCollector = createMockTimingCollector()
mock.module('./timing/TimingCollector', () => ({
  timingCollector: mockTimingCollector,
  TimingEventName,
}))

const mockVoiceInputService = {
  startAudioRecording: mock(() => Promise.resolve()),
  stopAudioRecording: mock(() => Promise.resolve()),
}
mock.module('./voiceInputService', () => ({
  voiceInputService: mockVoiceInputService,
}))

const mockRecordingStateNotifier = {
  notifyRecordingStarted: mock(),
  notifyRecordingStopped: mock(),
  notifyProcessingStarted: mock(),
  notifyProcessingStopped: mock(),
}
mock.module('./recordingStateNotifier', () => ({
  recordingStateNotifier: mockRecordingStateNotifier,
}))

const mockItoStreamController = {
  initialize: mock((_mode: any) => Promise.resolve(true)),
  setMode: mock(),
  getAudioDurationMs: mock(() => 500),
  getCurrentSampleRate: mock(() => 16000),
  endInteraction: mock(),
  cancelTranscription: mock(),
  clearInteractionAudio: mock(),
  processLocalTranscription: mock(() =>
    Promise.resolve({
      transcript: 'test transcript',
      audioBuffer: Buffer.alloc(0),
      sampleRate: 16000,
      durationMs: 500,
    }),
  ),
}
mock.module('./itoStreamController', () => ({
  itoStreamController: mockItoStreamController,
}))

const mockTextInserter = {
  insertText: mock(() => Promise.resolve(true)),
}
mock.module('./text/TextInserter', () => ({
  TextInserter: class MockTextInserter {
    insertText = mockTextInserter.insertText
  },
}))

const mockInteractionManager = {
  getCurrentInteractionId: mock((): string | null => null),
  adoptInteractionId: mock(),
  initialize: mock(() => 'test-interaction-123'),
  createInteraction: mock(() => Promise.resolve()),
  clearCurrentInteraction: mock(),
}
mock.module('./interactions/InteractionManager', () => ({
  interactionManager: mockInteractionManager,
}))

const mockContextGrabber = {
  getCursorContextForGrammar: mock(() => Promise.resolve('test context')),
}
mock.module('./context/ContextGrabber', () => ({
  contextGrabber: mockContextGrabber,
}))

const mockGrammarRulesService = {
  setCaseFirstWord: mock((text: string) => text),
  addLeadingSpaceIfNeeded: mock((text: string) => text),
}
mock.module('./grammar/GrammarRulesService', () => ({
  GrammarRulesService: class MockGrammarRulesService {
    setCaseFirstWord = mockGrammarRulesService.setCaseFirstWord
    addLeadingSpaceIfNeeded = mockGrammarRulesService.addLeadingSpaceIfNeeded
  },
}))

const mockGetAdvancedSettings = mock(() => ({
  grammarServiceEnabled: false,
}))
const mockStore = {
  get: mock((_path: string) => ({ interactionSounds: false })),
}
mock.module('./store', () => ({
  default: mockStore,
  getAdvancedSettings: mockGetAdvancedSettings,
}))

const testMode = (overrides: Record<string, unknown> = {}) => ({
  id: 'voice-to-text',
  userId: 'self-hosted',
  name: 'Voice to text',
  preset: 'voice-to-text',
  icon: 'Microphone',
  instructions: '',
  language: 'fr',
  voiceModelKey: 'whisper-large-v3-turbo',
  textModelKey: null,
  useLlm: false,
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
})

mock.module('./modes/activeMode', () => ({
  resolveActiveMode: async () => testMode(),
  resolveMode: async (id: string) =>
    id === 'intelligent'
      ? testMode({ id: 'intelligent', name: 'Intelligent', useLlm: true })
      : testMode(),
}))

const mockSoundFeedback = {
  playInteractionCompletionSound: mock(),
}
mock.module('./soundFeedback', () => ({
  playInteractionCompletionSound:
    mockSoundFeedback.playInteractionCompletionSound,
}))

mock.module('electron-log', () => ({
  default: { info: mock(), warn: mock(), error: mock() },
}))

beforeEach(() => {
  Object.values(mockVoiceInputService).forEach(fn => fn.mockClear())
  Object.values(mockRecordingStateNotifier).forEach(fn => fn.mockClear())
  Object.values(mockItoStreamController).forEach(fn => fn.mockClear())
  Object.values(mockTextInserter).forEach(fn => fn.mockClear())
  Object.values(mockInteractionManager).forEach(fn => fn.mockClear())
  Object.values(mockGrammarRulesService).forEach(fn => fn.mockClear())
  Object.values(mockTimingCollector).forEach(fn => fn.mockClear())
  Object.values(mockSoundFeedback).forEach(fn => fn.mockClear())
  mockGetAdvancedSettings.mockClear()
  mockStore.get.mockClear()
  mockStore.get.mockReturnValue({ interactionSounds: false })

  mockItoStreamController.initialize.mockImplementation(() =>
    Promise.resolve(true),
  )
  mockItoStreamController.getAudioDurationMs.mockReturnValue(500)
  mockItoStreamController.processLocalTranscription.mockResolvedValue({
    transcript: 'test transcript',
    audioBuffer: Buffer.alloc(0),
    sampleRate: 16000,
    durationMs: 500,
  })
})

describe('itoSessionManager (local mode)', () => {
  test('starts session and sets mode', async () => {
    const { ItoSessionManager } = await import('./itoSessionManager')
    const session = new ItoSessionManager()

    await session.startSession('voice-to-text')

    expect(mockItoStreamController.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'voice-to-text' }),
    )
    expect(mockItoStreamController.setMode).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'voice-to-text' }),
    )
    expect(mockVoiceInputService.startAudioRecording).toHaveBeenCalled()
  })

  test('collects grammar context at completion, not at session start', async () => {
    mockGetAdvancedSettings.mockReturnValue({ grammarServiceEnabled: true })

    const { ItoSessionManager } = await import('./itoSessionManager')
    const session = new ItoSessionManager()

    // Starting a session must NOT simulate keystrokes: the push-to-talk keys
    // are still physically held (held Alt + simulated Ctrl+C types "©").
    await session.startSession('voice-to-text')
    await new Promise(resolve => setTimeout(resolve, 40))
    expect(mockContextGrabber.getCursorContextForGrammar).not.toHaveBeenCalled()

    await session.completeSession()
    expect(mockContextGrabber.getCursorContextForGrammar).toHaveBeenCalled()
  })

  test('cancels session', async () => {
    const { ItoSessionManager } = await import('./itoSessionManager')
    const session = new ItoSessionManager()

    await session.cancelSession()

    expect(mockItoStreamController.cancelTranscription).toHaveBeenCalled()
    expect(mockVoiceInputService.stopAudioRecording).toHaveBeenCalled()
    expect(mockRecordingStateNotifier.notifyRecordingStopped).toHaveBeenCalled()
  })

  test('completes session and inserts transcript', async () => {
    const { ItoSessionManager } = await import('./itoSessionManager')
    const session = new ItoSessionManager()

    await session.startSession('voice-to-text')
    await session.completeSession()

    expect(mockItoStreamController.processLocalTranscription).toHaveBeenCalled()
    expect(mockTextInserter.insertText).toHaveBeenCalledWith('test transcript')
    expect(mockInteractionManager.createInteraction).toHaveBeenCalled()
    expect(
      mockSoundFeedback.playInteractionCompletionSound,
    ).not.toHaveBeenCalled()
  })

  test('plays completion sound when interaction sounds are enabled', async () => {
    mockStore.get.mockReturnValue({ interactionSounds: true })
    const { ItoSessionManager } = await import('./itoSessionManager')
    const session = new ItoSessionManager()

    await session.startSession('voice-to-text')
    await session.completeSession()

    expect(
      mockSoundFeedback.playInteractionCompletionSound,
    ).toHaveBeenCalledTimes(1)
  })

  test('does not play completion sound when no transcript is returned', async () => {
    mockStore.get.mockReturnValue({ interactionSounds: true })
    mockItoStreamController.processLocalTranscription.mockResolvedValue({
      transcript: '',
      audioBuffer: Buffer.alloc(0),
      sampleRate: 16000,
      durationMs: 500,
    })
    const { ItoSessionManager } = await import('./itoSessionManager')
    const session = new ItoSessionManager()

    await session.startSession('voice-to-text')
    await session.completeSession()

    expect(
      mockSoundFeedback.playInteractionCompletionSound,
    ).not.toHaveBeenCalled()
  })

  test('does not play completion sound when transcription fails', async () => {
    mockStore.get.mockReturnValue({ interactionSounds: true })
    mockItoStreamController.processLocalTranscription.mockRejectedValue(
      new Error('transcription failed'),
    )
    const { ItoSessionManager } = await import('./itoSessionManager')
    const session = new ItoSessionManager()

    await session.startSession('voice-to-text')
    await session.completeSession()

    expect(
      mockSoundFeedback.playInteractionCompletionSound,
    ).not.toHaveBeenCalled()
  })

  test('skips processing when audio is too short', async () => {
    mockStore.get.mockReturnValue({ interactionSounds: true })
    mockItoStreamController.getAudioDurationMs.mockReturnValue(50)
    const { ItoSessionManager } = await import('./itoSessionManager')
    const session = new ItoSessionManager()

    await session.startSession('voice-to-text')
    await session.completeSession()

    expect(mockItoStreamController.cancelTranscription).toHaveBeenCalled()
    expect(
      mockItoStreamController.processLocalTranscription,
    ).not.toHaveBeenCalled()
    expect(
      mockSoundFeedback.playInteractionCompletionSound,
    ).not.toHaveBeenCalled()
  })
})

describe('itoSessionManager (state machine)', () => {
  test('ignores a second startSession while one is active', async () => {
    const { ItoSessionManager } = await import('./itoSessionManager')
    const session = new ItoSessionManager()

    await session.startSession('voice-to-text')
    const second = await session.startSession('voice-to-text')

    expect(second).toBeNull()
    expect(mockItoStreamController.initialize).toHaveBeenCalledTimes(1)
    expect(session.getState()).toBe('recording')
  })

  test('completeSession without an active session is a no-op', async () => {
    const { ItoSessionManager } = await import('./itoSessionManager')
    const session = new ItoSessionManager()

    await session.completeSession()

    expect(mockVoiceInputService.stopAudioRecording).not.toHaveBeenCalled()
    expect(
      mockItoStreamController.processLocalTranscription,
    ).not.toHaveBeenCalled()
  })

  test('completeSession during a slow start waits for the start to settle', async () => {
    let resolveInit: (value: boolean) => void = () => {}
    mockItoStreamController.initialize.mockImplementation(
      () =>
        new Promise<boolean>(resolve => {
          resolveInit = resolve
        }),
    )
    const { ItoSessionManager } = await import('./itoSessionManager')
    const session = new ItoSessionManager()

    const startPromise = session.startSession('voice-to-text')
    const completePromise = session.completeSession()
    // Le démarrage résout d'abord le mode : `initialize` n'est appelé qu'au
    // tour suivant, donc `resolveInit` n'existe pas encore à cet instant.
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(
      mockItoStreamController.processLocalTranscription,
    ).not.toHaveBeenCalled()

    resolveInit(true)
    await startPromise
    await completePromise

    expect(
      mockItoStreamController.processLocalTranscription,
    ).toHaveBeenCalledTimes(1)
    expect(session.getState()).toBe('idle')
  })

  test('failed start resets to idle and allows a new session', async () => {
    mockItoStreamController.initialize.mockImplementationOnce(() =>
      Promise.resolve(false),
    )
    const { ItoSessionManager } = await import('./itoSessionManager')
    const session = new ItoSessionManager()

    const first = await session.startSession('voice-to-text')

    expect(first).toBeNull()
    expect(session.getState()).toBe('idle')
    expect(mockVoiceInputService.startAudioRecording).not.toHaveBeenCalled()
    expect(mockRecordingStateNotifier.notifyRecordingStopped).toHaveBeenCalled()

    await session.startSession('voice-to-text')
    expect(session.getState()).toBe('recording')
  })

  test('cancelSession during processing discards the transcript', async () => {
    let resolveProcess: (value: any) => void = () => {}
    mockItoStreamController.processLocalTranscription.mockImplementation(
      () =>
        new Promise<any>(resolve => {
          resolveProcess = resolve
        }),
    )
    const { ItoSessionManager } = await import('./itoSessionManager')
    const session = new ItoSessionManager()

    await session.startSession('voice-to-text')
    const completePromise = session.completeSession()
    // Let completeSession advance past the audio checks into processing
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(session.getState()).toBe('processing')

    await session.cancelSession()
    resolveProcess({
      transcript: 'late transcript',
      audioBuffer: Buffer.alloc(0),
      sampleRate: 16000,
      durationMs: 500,
    })
    await completePromise

    expect(mockTextInserter.insertText).not.toHaveBeenCalled()
    expect(session.getState()).toBe('idle')
  })

  test('setMode is ignored when no session is active', async () => {
    const { ItoSessionManager } = await import('./itoSessionManager')
    const session = new ItoSessionManager()

    await session.setMode('intelligent')

    expect(mockItoStreamController.setMode).not.toHaveBeenCalled()
    expect(
      mockRecordingStateNotifier.notifyRecordingStarted,
    ).not.toHaveBeenCalled()
  })
})
