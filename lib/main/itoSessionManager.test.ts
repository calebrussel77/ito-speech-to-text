import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { ItoMode } from '@/app/generated/ito_pb'
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
  initialize: mock((_mode: ItoMode) => Promise.resolve(true)),
  setMode: mock(),
  getAudioDurationMs: mock(() => 500),
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
mock.module('./store', () => ({
  getAdvancedSettings: mockGetAdvancedSettings,
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
  mockGetAdvancedSettings.mockClear()

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

    await session.startSession(ItoMode.TRANSCRIBE)

    expect(mockItoStreamController.initialize).toHaveBeenCalledWith(
      ItoMode.TRANSCRIBE,
    )
    expect(mockItoStreamController.setMode).toHaveBeenCalledWith(
      ItoMode.TRANSCRIBE,
    )
    expect(mockVoiceInputService.startAudioRecording).toHaveBeenCalled()
  })

  test('collects grammar context when enabled', async () => {
    mockGetAdvancedSettings.mockReturnValue({ grammarServiceEnabled: true })

    const { ItoSessionManager } = await import('./itoSessionManager')
    const session = new ItoSessionManager()

    await session.startSession(ItoMode.TRANSCRIBE)
    await new Promise(resolve => setTimeout(resolve, 40))

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

    await session.startSession(ItoMode.TRANSCRIBE)
    await session.completeSession()

    expect(mockItoStreamController.processLocalTranscription).toHaveBeenCalled()
    expect(mockTextInserter.insertText).toHaveBeenCalledWith('test transcript')
    expect(mockInteractionManager.createInteraction).toHaveBeenCalled()
  })

  test('skips processing when audio is too short', async () => {
    mockItoStreamController.getAudioDurationMs.mockReturnValue(50)
    const { ItoSessionManager } = await import('./itoSessionManager')
    const session = new ItoSessionManager()

    await session.startSession(ItoMode.TRANSCRIBE)
    await session.completeSession()

    expect(mockItoStreamController.cancelTranscription).toHaveBeenCalled()
    expect(mockItoStreamController.processLocalTranscription).not.toHaveBeenCalled()
  })
})
