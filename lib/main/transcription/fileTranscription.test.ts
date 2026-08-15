import { describe, test, expect, mock, beforeEach } from 'bun:test'

type Segment = {
  speaker: number
  label: string
  startMs: number
  endMs: number
  text: string
}

let deepgramResult: { text: string; segments: Segment[] } = {
  text: 'transcript',
  segments: [],
}
const mockDeepgram = mock(async () => deepgramResult)
mock.module('./DeepgramTranscriptionService', () => ({
  deepgramTranscriptionService: { transcribeAudio: mockDeepgram },
}))

const mockGoogle = mock(async () => ({
  text: 'gemini transcript',
  segments: [],
}))
mock.module('./GoogleTranscriptionService', () => ({
  googleTranscriptionService: { transcribeAudio: mockGoogle },
}))

const mockOpenAI = mock(async () => ({
  text: 'openai transcript',
  segments: [],
}))
mock.module('./OpenAITranscriptionService', () => ({
  openaiTranscriptionService: { transcribeAudio: mockOpenAI },
}))

const mockCreateRecovered = mock(async () => 'interaction-1')
mock.module('../interactions/InteractionManager', () => ({
  interactionManager: { createRecoveredInteraction: mockCreateRecovered },
}))

const mockResolveMode = mock(async (modeId: string) => ({ id: modeId }))
// Le mode actif ne sert plus qu'à sa langue : le reste de ses réglages
// (instructions, réécriture, diarisation) ne doit plus atteindre ce chemin.
const mockResolveActiveMode = mock(async () => ({
  id: 'meeting',
  name: 'Meeting',
  language: 'fr',
  identifySpeakers: false,
  useLlm: true,
  instructions: '## Role\nSummarise the meeting',
}))
mock.module('../modes/activeMode', () => ({
  resolveMode: mockResolveMode,
  resolveActiveMode: mockResolveActiveMode,
}))

const mockAdjust = mock(async (text: string) => `rewritten: ${text}`)
mock.module('./TranscriptAdjuster', () => ({
  transcriptAdjuster: { adjust: mockAdjust },
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
let googleApiKey = ''
let openaiApiKey = ''
let fileTranscriptionModelKey = ''
mock.module('../store', () => ({
  getAdvancedSettings: () => ({
    deepgramApiKey,
    googleApiKey,
    openaiApiKey,
    fileTranscriptionModelKey,
  }),
  getCurrentUserId: () => 'self-hosted',
  default: { get: () => undefined, set: () => {} },
  store: { get: () => undefined, set: () => {} },
}))

const { transcribeExistingFile } = await import('./fileTranscription')

const segment = (speaker: number, text: string): Segment => ({
  speaker,
  label: `Speaker ${speaker + 1}`,
  startMs: speaker * 1000,
  endMs: speaker * 1000 + 900,
  text,
})

describe('transcribeExistingFile', () => {
  beforeEach(() => {
    mockDeepgram.mockClear()
    mockCreateRecovered.mockClear()
    mockResolveMode.mockClear()
    mockResolveActiveMode.mockClear()
    mockAdjust.mockClear()
    mockGoogle.mockClear()
    mockOpenAI.mockClear()
    deepgramApiKey = 'dg-test'
    googleApiKey = ''
    openaiApiKey = ''
    fileTranscriptionModelKey = ''
    deepgramResult = { text: 'transcript', segments: [] }
  })

  test('sends the file to Deepgram and stores the result in the history', async () => {
    const result = await transcribeExistingFile('C:/meeting.wav')

    expect(result.ok).toBe(true)
    expect(mockDeepgram).toHaveBeenCalledTimes(1)
    expect(mockCreateRecovered).toHaveBeenCalledTimes(1)
  })

  test('always asks for diarization, whatever the active mode says', async () => {
    // C'est le seul moyen de savoir combien de personnes parlent. Le mode actif
    // du test a `identifySpeakers: false` : s'il était encore consulté, aucun
    // fichier de réunion ne serait jamais découpé par locuteur.
    await transcribeExistingFile('C:/meeting.wav')

    const options = (mockDeepgram.mock.calls[0] as any[])[1]
    expect(options.diarize).toBe(true)
  })

  test('never rewrites the transcript with the active mode instructions', async () => {
    // La régression rapportée : importer une réunion pendant que le mode
    // Meeting était actif faisait passer le transcript par ses instructions,
    // écrites pour une dictée en direct. Le résultat n'avait plus de rapport
    // avec le fichier. `useLlm: true` sur le mode actif ne doit rien déclencher.
    const result = await transcribeExistingFile('C:/meeting.wav')

    expect(result.ok).toBe(true)
    expect(mockAdjust).not.toHaveBeenCalled()
    expect((mockCreateRecovered.mock.calls[0] as any[])[0]).toBe('transcript')
  })

  test('attributes the import to no mode at all', async () => {
    await transcribeExistingFile('C:/meeting.wav')

    const extra = (mockCreateRecovered.mock.calls[0] as any[])[5]
    expect(extra.modeId).toBeUndefined()
    expect(extra.modeName).toBeUndefined()
  })

  test('several speakers give a named, timestamped transcript', async () => {
    deepgramResult = {
      text: 'bonjour salut',
      segments: [segment(0, 'bonjour'), segment(1, 'salut')],
    }

    const result = await transcribeExistingFile('C:/meeting.wav')

    expect(result.speakerCount).toBe(2)
    const [text, , , , , extra] = mockCreateRecovered.mock.calls[0] as any[]
    expect(text).toBe(
      '[00:00-00:01] Speaker 1: bonjour\n[00:01-00:02] Speaker 2: salut',
    )
    // Le transcript brut reste à côté du transcript nommé.
    expect(extra.rawTranscript).toBe('bonjour salut')
    expect(extra.speakers).toHaveLength(2)
  })

  test('a single speaker gives plain text, with no speaker labels', async () => {
    // Un mémo dicté seul n'a rien à gagner à un « Speaker 1: » en tête de
    // chaque ligne, et la vue Speakers de l'historique n'aurait rien à montrer.
    deepgramResult = {
      text: 'note pour moi-même',
      segments: [segment(0, 'note pour moi-même')],
    }

    const result = await transcribeExistingFile('C:/memo.wav')

    expect(result.speakerCount).toBe(1)
    const [text, , , , , extra] = mockCreateRecovered.mock.calls[0] as any[]
    expect(text).toBe('note pour moi-même')
    expect(extra.speakers).toBeUndefined()
  })

  test('borrows the spoken language from the active mode', async () => {
    // La seule chose qu'un mode dise encore ici. Sans indice, `nova-3` retombe
    // sur l'anglais et rend une bouillie sur une réunion française.
    await transcribeExistingFile('C:/meeting.wav')

    const options = (mockDeepgram.mock.calls[0] as any[])[1]
    expect(options.language).toBe('fr')
  })

  test('sends the file to Gemini when that is the chosen model', async () => {
    fileTranscriptionModelKey = 'gemini-3-7-flash-audio'
    googleApiKey = 'AIza-test'

    const result = await transcribeExistingFile('C:/meeting.m4a')

    expect(result.ok).toBe(true)
    expect(mockGoogle).toHaveBeenCalledTimes(1)
    expect(mockDeepgram).not.toHaveBeenCalled()
    // Le slug du catalogue, pas la clé : c'est ce que l'API attend.
    expect((mockGoogle.mock.calls[0] as any[])[1].model).toBe(
      'gemini-3.7-flash',
    )
    expect((mockGoogle.mock.calls[0] as any[])[1].diarize).toBe(true)
  })

  test('sends the file to OpenAI when that is the chosen model', async () => {
    fileTranscriptionModelKey = 'gpt-4o-transcribe-diarize-openai'
    openaiApiKey = 'sk-test'

    const result = await transcribeExistingFile('C:/meeting.m4a')

    expect(result.ok).toBe(true)
    expect(mockOpenAI).toHaveBeenCalledTimes(1)
    expect(mockDeepgram).not.toHaveBeenCalled()
    const options = (mockOpenAI.mock.calls[0] as any[])[1]
    // Le slug du catalogue, pas la clé : c'est ce que l'API attend.
    expect(options.model).toBe('gpt-4o-transcribe-diarize')
    expect(options.diarize).toBe(true)
    expect(options.language).toBe('fr')
    // Le slug est stocké nu : préfixé `openai/…` il désignerait l'entrée
    // OpenRouter du même modèle dans le badge de l'historique.
    expect((mockCreateRecovered.mock.calls[0] as any[])[4]).toBe(
      'gpt-4o-transcribe-diarize',
    )
  })

  test('refuses an OpenAI file without an OpenAI key, naming the model', async () => {
    fileTranscriptionModelKey = 'gpt-transcribe-openai'

    const result = await transcribeExistingFile('C:/meeting.m4a')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('OpenAI API key')
    expect(mockDeepgram).not.toHaveBeenCalled()
    expect(mockOpenAI).not.toHaveBeenCalled()
  })

  test('keeps Deepgram when no file model has been chosen', async () => {
    googleApiKey = 'AIza-test'

    await transcribeExistingFile('C:/meeting.wav')

    expect(mockDeepgram).toHaveBeenCalledTimes(1)
    expect(mockGoogle).not.toHaveBeenCalled()
  })

  test('refuses a Gemini file without a Google key, naming the model', async () => {
    // Et surtout pas en retombant sur Deepgram en silence : le résultat
    // viendrait d'un autre moteur que celui affiché dans les réglages.
    fileTranscriptionModelKey = 'gemini-3-7-flash-audio'

    const result = await transcribeExistingFile('C:/meeting.m4a')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('Google API key')
    expect(mockDeepgram).not.toHaveBeenCalled()
    expect(mockGoogle).not.toHaveBeenCalled()
  })

  test('falls back to Deepgram when the chosen model left the catalogue', async () => {
    fileTranscriptionModelKey = 'a-model-that-no-longer-exists'

    const result = await transcribeExistingFile('C:/meeting.wav')

    expect(result.ok).toBe(true)
    expect(mockDeepgram).toHaveBeenCalledTimes(1)
  })

  test('refuses without a Deepgram key rather than silently doing nothing', async () => {
    deepgramApiKey = ''

    const result = await transcribeExistingFile('C:/meeting.wav')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Deepgram')
  })

  // Finding 2: createRecoveredInteraction swallows its own DB errors and
  // resolves undefined instead of throwing — a missing id IS the failure,
  // not a success with no interactionId.
  test('reports failure when the history write silently fails', async () => {
    mockCreateRecovered.mockResolvedValueOnce(undefined as any)

    const result = await transcribeExistingFile('C:/meeting.wav')

    expect(result.ok).toBe(false)
    expect(result.interactionId).toBeUndefined()
    expect(result.error).toBeTruthy()
  })
})
