import { describe, test, expect, mock, beforeEach } from 'bun:test'

const mockDeepgram = mock(async () => ({ text: 'transcript', segments: [] }))
mock.module('./DeepgramTranscriptionService', () => ({
  deepgramTranscriptionService: { transcribeAudio: mockDeepgram },
}))

const mockCreateRecovered = mock(async () => {})
mock.module('../interactions/InteractionManager', () => ({
  interactionManager: { createRecoveredInteraction: mockCreateRecovered },
}))

mock.module('../modes/activeMode', () => ({
  resolveMode: async () => ({
    id: 'meeting',
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
  }),
  resolveActiveMode: async () => ({ id: 'meeting', name: 'Meeting' }),
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
    deepgramApiKey = 'dg-test'
  })

  test('sends the file to Deepgram and stores the result in the history', async () => {
    const result = await transcribeExistingFile('C:/meeting.wav', 'meeting')

    expect(result.ok).toBe(true)
    expect(mockDeepgram).toHaveBeenCalledTimes(1)
    expect(mockCreateRecovered).toHaveBeenCalledTimes(1)
  })

  test('refuses without a Deepgram key rather than silently doing nothing', async () => {
    deepgramApiKey = ''

    const result = await transcribeExistingFile('C:/meeting.wav', 'meeting')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Deepgram')
  })
})
