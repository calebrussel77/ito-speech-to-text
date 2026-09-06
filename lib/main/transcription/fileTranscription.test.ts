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

const mockGetVocabulary = mock(async () => ({
  vocabularyWords: ['Nfluenzo'],
  dictionaryEntries: ['Nfluenzo'],
}))
mock.module('../context/ContextGrabber', () => ({
  contextGrabber: { getVocabulary: mockGetVocabulary },
}))

const mockOpenRouterAudio = mock(async () => ({
  text: 'openrouter transcript',
  segments: [] as Segment[],
}))
mock.module('./OpenRouterAudioService', () => ({
  openRouterAudioService: { transcribeAudio: mockOpenRouterAudio },
}))

const mockPolishDialogue = mock(async (segments: Segment[]) =>
  segments.map(s => ({ ...s, text: `polished ${s.text}` })),
)
const mockPolishPlainText = mock(async (text: string) => `polished ${text}`)
let inferResult: {
  isConversation: boolean
  segments: Segment[]
  text: string
} | null = null
const mockInferSpeakers = mock(
  async (text: string) =>
    inferResult ?? { isConversation: false, segments: [], text },
)
mock.module('./dialoguePolish', () => ({
  polishDialogue: mockPolishDialogue,
  polishPlainText: mockPolishPlainText,
  inferSpeakersFromText: mockInferSpeakers,
}))

let uploadResult: {
  bytes: Buffer
  contentType: string
  fileName: string
  transcoded: boolean
} | null = null
const mockPrepareUpload = mock(
  async (filePath: string, original: Buffer) =>
    uploadResult ?? {
      bytes: original,
      contentType: filePath.endsWith('.wav')
        ? 'audio/wav'
        : filePath.endsWith('.m4a')
          ? 'audio/mp4'
          : 'audio/mpeg',
      fileName: filePath.split('/').pop()!,
      transcoded: false,
    },
)
mock.module('../audio/transcodeForUpload', () => ({
  prepareUploadAudio: mockPrepareUpload,
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
let openRouterApiKey = ''
let fileTranscriptionModelKey = ''
mock.module('../store', () => ({
  getAdvancedSettings: () => ({
    deepgramApiKey,
    googleApiKey,
    openaiApiKey,
    openRouterApiKey,
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
    openRouterApiKey = ''
    uploadResult = null
    mockOpenRouterAudio.mockClear()
    mockPolishDialogue.mockClear()
    mockPolishPlainText.mockClear()
    mockInferSpeakers.mockClear()
    inferResult = null
    mockPrepareUpload.mockClear()
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
    // Seule la relecture d'ASR (mots, ponctuation) touche au texte — jamais
    // les instructions d'un mode.
    expect((mockCreateRecovered.mock.calls[0] as any[])[0]).toBe(
      'polished transcript',
    )
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
    // Relu par le modèle texte (le mock préfixe chaque tour), puis nommé.
    expect(text).toBe(
      '[00:00-00:01] Speaker 1: polished bonjour\n[00:01-00:02] Speaker 2: polished salut',
    )
    // Le transcript brut du moteur reste à côté du transcript relu.
    expect(extra.rawTranscript).toBe(
      '[00:00-00:01] Speaker 1: bonjour\n[00:01-00:02] Speaker 2: salut',
    )
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
    expect(text).toBe('polished note pour moi-même')
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
    // The user's dictionary is the only vocabulary hint there is.
    expect((mockGoogle.mock.calls[0] as any[])[1].vocabulary).toEqual([
      'Nfluenzo',
    ])
  })

  test('the upload is prepared once, and what it yields is what the engine gets', async () => {
    uploadResult = {
      bytes: Buffer.from('mp3'),
      contentType: 'audio/mpeg',
      fileName: 'meeting.mp3',
      transcoded: true,
    }
    await transcribeExistingFile('C:/meeting.m4a')
    expect(mockPrepareUpload).toHaveBeenCalledTimes(1)
    expect((mockDeepgram.mock.calls[0] as any[])[0]).toEqual(Buffer.from('mp3'))
    expect((mockDeepgram.mock.calls[0] as any[])[1].contentType).toBe(
      'audio/mpeg',
    )
    const extra = (mockCreateRecovered.mock.calls[0] as any[])[5]
    expect(extra.latency.uploadBytes).toBe(3)
  })

  test('an ASR transcript is proofread by the text model, a multimodal one is not', async () => {
    deepgramResult = {
      text: 'x',
      segments: [
        segment(0, 'on a testé influence zoo hier et ça marche bien'),
        segment(1, "d'accord très bien on regarde ça ensemble"),
      ],
    }
    await transcribeExistingFile('C:/call.m4a')
    expect(mockPolishDialogue).toHaveBeenCalledTimes(1)
    const extra = (mockCreateRecovered.mock.calls[0] as any[])[5]
    expect(extra.speakers[0].text).toBe(
      'polished on a testé influence zoo hier et ça marche bien',
    )
    // The raw engine output is kept next to it.
    expect(extra.rawTranscript).toContain('on a testé influence zoo hier')

    mockPolishDialogue.mockClear()
    mockCreateRecovered.mockClear()
    deepgramApiKey = ''
    openRouterApiKey = 'or-test'
    await transcribeExistingFile('C:/call.m4a')
    expect(mockOpenRouterAudio).toHaveBeenCalledTimes(1)
    expect(mockPolishDialogue).not.toHaveBeenCalled()
    expect(mockPolishPlainText).not.toHaveBeenCalled()
    deepgramApiKey = 'dg-test'
  })

  test('an engine that cannot separate voices gets its speakers inferred from the text', async () => {
    fileTranscriptionModelKey = 'gpt-transcribe-openai'
    openaiApiKey = 'sk-test'
    const flat = Array.from({ length: 80 }, (_, i) => `mot${i}`).join(' ')
    mockOpenAI.mockResolvedValueOnce({ text: flat, segments: [] })
    inferResult = {
      isConversation: true,
      segments: [
        segment(0, 'bonjour, je vous appelle'),
        segment(1, "d'accord"),
      ],
      text: "bonjour, je vous appelle d'accord",
    }

    const result = await transcribeExistingFile('C:/call.m4a')

    expect(result.ok).toBe(true)
    expect(result.speakerCount).toBe(2)
    expect(mockInferSpeakers).toHaveBeenCalledWith(
      flat,
      expect.objectContaining({ vocabulary: ['Nfluenzo'], language: 'fr' }),
      expect.anything(),
    )
    // Already proofread in the same pass: no second rewrite.
    expect(mockPolishDialogue).not.toHaveBeenCalled()
    expect(mockPolishPlainText).not.toHaveBeenCalled()
    const [text, , , , , extra] = mockCreateRecovered.mock.calls[0] as any[]
    expect(text).toContain("Speaker 2: d'accord")
    expect(extra.speakers).toHaveLength(2)
    // The flat engine output stays as the original.
    expect(extra.rawTranscript).toBe(flat)
    fileTranscriptionModelKey = ''
    openaiApiKey = ''
  })

  test('a flat transcript the text model sees as one voice stays plain, already proofread', async () => {
    fileTranscriptionModelKey = 'gpt-transcribe-openai'
    openaiApiKey = 'sk-test'
    const flat = Array.from({ length: 80 }, (_, i) => `mot${i}`).join(' ')
    mockOpenAI.mockResolvedValueOnce({ text: flat, segments: [] })
    inferResult = { isConversation: false, segments: [], text: `relu ${flat}` }

    const result = await transcribeExistingFile('C:/memo.m4a')

    expect(result.speakerCount).toBe(0)
    expect(mockPolishPlainText).not.toHaveBeenCalled()
    expect((mockCreateRecovered.mock.calls[0] as any[])[0]).toBe(`relu ${flat}`)
    fileTranscriptionModelKey = ''
    openaiApiKey = ''
  })

  test('a short flat transcript is not worth a speaker inference', async () => {
    deepgramResult = { text: 'trois mots seulement', segments: [] }
    await transcribeExistingFile('C:/memo.m4a')
    expect(mockInferSpeakers).not.toHaveBeenCalled()
    expect(mockPolishPlainText).toHaveBeenCalled()
  })

  test('a single-voice ASR memo is proofread as plain text', async () => {
    deepgramResult = { text: 'un mémo', segments: [segment(0, 'un mémo')] }
    await transcribeExistingFile('C:/memo.m4a')
    expect(mockPolishPlainText).toHaveBeenCalledWith(
      'un mémo',
      ['Nfluenzo'],
      expect.anything(),
    )
    expect((mockCreateRecovered.mock.calls[0] as any[])[0]).toBe(
      'polished un mémo',
    )
  })

  test('without a chosen model, the first provider with a key takes the file', async () => {
    deepgramApiKey = ''
    openRouterApiKey = 'or-test'
    const result = await transcribeExistingFile('C:/call.m4a')
    expect(result.ok).toBe(true)
    expect(mockOpenRouterAudio).toHaveBeenCalledTimes(1)
    const options = (mockOpenRouterAudio.mock.calls[0] as any[])[1]
    expect(options.model).toBe('google/gemini-3.7-flash')
    expect(options.vocabulary).toEqual(['Nfluenzo'])
    expect(options.format).toBe('mp3')
    const engine = (mockCreateRecovered.mock.calls[0] as any[])[4]
    expect(engine).toBe('openrouter/google/gemini-3.7-flash')
    deepgramApiKey = 'dg-test'
  })

  test('a chosen OpenRouter model without an OpenRouter key is refused by name', async () => {
    fileTranscriptionModelKey = 'gemini-3-7-flash-openrouter-audio'
    const result = await transcribeExistingFile('C:/call.m4a')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Gemini 3.7 Flash')
    expect(result.error).toContain('OpenRouter')
    fileTranscriptionModelKey = ''
  })

  test('a stray voice with two words does not turn a memo into a dialogue', async () => {
    deepgramResult = {
      text: 'un long mémo',
      segments: [
        {
          ...segment(
            0,
            'un long mémo avec beaucoup de mots dedans vraiment beaucoup',
          ),
        },
        { ...segment(1, 'euh') },
        {
          ...segment(0, 'et encore plus de mots pour finir ce mémo proprement'),
        },
      ],
    }

    const result = await transcribeExistingFile('C:/memo.m4a')

    expect(result.speakerCount).toBe(1)
    const extra = (mockCreateRecovered.mock.calls[0] as any[])[5]
    expect(extra.speakers).toBeUndefined()
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
