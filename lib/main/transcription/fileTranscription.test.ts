import { describe, test, expect, mock, beforeEach } from 'bun:test'

const mockDeepgram = mock(async () => ({ text: 'transcript', segments: [] }))
mock.module('./DeepgramTranscriptionService', () => ({
  deepgramTranscriptionService: { transcribeAudio: mockDeepgram },
}))

const mockCreateRecovered = mock(async () => 'interaction-1')
mock.module('../interactions/InteractionManager', () => ({
  interactionManager: { createRecoveredInteraction: mockCreateRecovered },
}))

const mockResolveMode = mock(async (modeId: string) => ({
  id: modeId,
  name: 'Meeting',
  language: 'fr',
  identifySpeakers: true,
  useLlm: false,
  voiceModelKey: 'nova-3',
  textModelKey: null,
  instructions: '',
  contextApplication: false,
  contextClipboard: false,
  contextSelection: false,
}))
// Un mode distinct de celui rendu par `resolveMode`, pour distinguer sans
// ambiguïté lequel des deux a réellement été consulté par le code sous test.
const mockResolveActiveMode = mock(async () => ({
  id: 'voice-to-text',
  name: 'Voice to text',
  language: 'en',
  identifySpeakers: false,
  useLlm: false,
  voiceModelKey: 'nova-3',
  textModelKey: null,
  instructions: '',
  contextApplication: false,
  contextClipboard: false,
  contextSelection: false,
}))
mock.module('../modes/activeMode', () => ({
  resolveMode: mockResolveMode,
  resolveActiveMode: mockResolveActiveMode,
}))

const fileBytes = Buffer.from('RIFF....WAVEfmt ')
mock.module('fs', () => ({
  default: {
    readFileSync: () => fileBytes,
    existsSync: () => true,
    statSync: () => ({ size: fileBytes.length }),
  },
  readFileSync: () => fileBytes,
  existsSync: () => true,
  statSync: () => ({ size: fileBytes.length }),
}))

// Mutable like `fileBytes` above: a mocked module's named exports are
// read-only ESM bindings, so a test can't reassign `store.getAdvancedSettings`
// after import — it has to change what this closure returns instead.
let deepgramApiKey = 'dg-test'
mock.module('../store', () => ({
  getAdvancedSettings: () => ({ deepgramApiKey }),
  getCurrentUserId: () => 'self-hosted',
  default: { get: () => undefined, set: () => {} },
  store: { get: () => undefined, set: () => {} },
}))

const { transcribeExistingFile } = await import('./fileTranscription')

describe('transcribeExistingFile', () => {
  beforeEach(() => {
    mockDeepgram.mockClear()
    mockCreateRecovered.mockClear()
    mockResolveMode.mockClear()
    mockResolveActiveMode.mockClear()
    deepgramApiKey = 'dg-test'
  })

  test('sends the file to Deepgram and stores the result in the history', async () => {
    const result = await transcribeExistingFile('C:/meeting.wav', 'meeting')

    expect(result.ok).toBe(true)
    expect(mockDeepgram).toHaveBeenCalledTimes(1)
    expect(mockCreateRecovered).toHaveBeenCalledTimes(1)
    expect(mockResolveMode).toHaveBeenCalledTimes(1)
    expect(mockResolveActiveMode).not.toHaveBeenCalled()
    const extra = (mockCreateRecovered.mock.calls[0] as any[])[5]
    expect(extra.modeName).toBe('Meeting')
  })

  test('refuses without a Deepgram key rather than silently doing nothing', async () => {
    deepgramApiKey = ''

    const result = await transcribeExistingFile('C:/meeting.wav', 'meeting')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Deepgram')
  })

  // Finding 2: createRecoveredInteraction swallows its own DB errors and
  // resolves undefined instead of throwing — a missing id IS the failure,
  // not a success with no interactionId.
  test('reports failure when the history write silently fails', async () => {
    mockCreateRecovered.mockResolvedValueOnce(undefined as any)

    const result = await transcribeExistingFile('C:/meeting.wav', 'meeting')

    expect(result.ok).toBe(false)
    expect(result.interactionId).toBeUndefined()
    expect(result.error).toBeTruthy()
  })

  // Finding 1: the only real caller (the "Transcribe a file" button) never
  // supplies a modeId, so this path is the one that matters in production —
  // it must consult the *active* mode, not resolveMode(undefined)'s fallback
  // to the first row by sort_order.
  test('with no modeId, resolves the active mode rather than the first mode', async () => {
    const result = await transcribeExistingFile('C:/memo.wav')

    expect(result.ok).toBe(true)
    expect(mockResolveActiveMode).toHaveBeenCalledTimes(1)
    expect(mockResolveMode).not.toHaveBeenCalled()
    const extra = (mockCreateRecovered.mock.calls[0] as any[])[5]
    expect(extra.modeName).toBe('Voice to text')
  })
})
