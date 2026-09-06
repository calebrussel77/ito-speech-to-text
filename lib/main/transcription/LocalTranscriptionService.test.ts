import { describe, test, expect, beforeEach, mock } from 'bun:test'

const mockTranscriptionsCreate = mock(async (_args: any) => ({
  text: 'bonjour le monde',
  segments: [
    { text: 'bonjour le monde', no_speech_prob: 0.01, avg_logprob: -0.1 },
  ],
}))

mock.module('groq-sdk', () => ({
  default: class MockGroq {
    audio = { transcriptions: { create: mockTranscriptionsCreate } }
    chat = { completions: { create: mock(async () => ({ choices: [] })) } }
    constructor(_opts: any) {}
  },
}))
mock.module('groq-sdk/uploads', () => ({
  toFile: mock(async (buffer: Buffer, name: string) => ({ buffer, name })),
}))

const {
  localTranscriptionService,
  LocalTranscriptionError,
  createTranscriptionPrompt,
  filterSpeechSegments,
} = await import('./LocalTranscriptionService')

beforeEach(() => {
  mockTranscriptionsCreate.mockClear()
  mockTranscriptionsCreate.mockResolvedValue({
    text: 'bonjour le monde',
    segments: [
      { text: 'bonjour le monde', no_speech_prob: 0.01, avg_logprob: -0.1 },
    ],
  })
  localTranscriptionService.initialize('gsk_test_key')
})

describe('createTranscriptionPrompt', () => {
  test('uses the French default base without vocabulary', () => {
    const prompt = createTranscriptionPrompt([])
    expect(prompt).toContain('Dictée en français')
  })

  test('appends vocabulary to the base prompt', () => {
    const prompt = createTranscriptionPrompt(['gRPC', 'Electron'])
    expect(prompt).toContain('Dictée en français')
    expect(prompt).toContain('Vocabulaire : gRPC, Electron.')
  })

  test('a custom prompt replaces the base but keeps vocabulary', () => {
    const prompt = createTranscriptionPrompt(['bun'], 'Mon prompt à moi.')
    expect(prompt).toContain('Mon prompt à moi.')
    expect(prompt).not.toContain('Dictée en français')
    expect(prompt).toContain('Vocabulaire : bun.')
  })

  test('caps the vocabulary at ~224 tokens', () => {
    const bigVocab = Array.from({ length: 500 }, (_, i) => `motTechnique${i}`)
    const prompt = createTranscriptionPrompt(bigVocab)
    expect(Math.ceil(prompt.length / 4)).toBeLessThanOrEqual(224)
  })
})

describe('filterSpeechSegments', () => {
  test('reports allNoSpeech when every segment is silence', () => {
    const result = filterSpeechSegments(
      [
        { text: ' Merci', no_speech_prob: 0.9, avg_logprob: -0.2 },
        { text: " d'avoir regardé", no_speech_prob: 0.95, avg_logprob: -0.3 },
      ],
      0.6,
    )
    expect(result.allNoSpeech).toBe(true)
    expect(result.text).toBeNull()
  })

  test('drops hallucinated segments but keeps real speech', () => {
    const result = filterSpeechSegments(
      [
        {
          text: 'Bonjour tout le monde.',
          no_speech_prob: 0.02,
          avg_logprob: -0.15,
        },
        {
          text: ' Sous-titres réalisés par Amara.org',
          no_speech_prob: 0.8,
          avg_logprob: -0.9,
        },
      ],
      0.6,
    )
    expect(result.allNoSpeech).toBe(false)
    expect(result.text).toBe('Bonjour tout le monde.')
  })

  test('keeps everything when all segments are clean', () => {
    const result = filterSpeechSegments(
      [
        { text: 'Un.', no_speech_prob: 0.01, avg_logprob: -0.1 },
        { text: ' Deux.', no_speech_prob: 0.02, avg_logprob: -0.2 },
      ],
      0.6,
    )
    expect(result.text).toBe('Un. Deux.')
  })

  test('returns null text for empty segments so caller falls back', () => {
    const result = filterSpeechSegments([], 0.6)
    expect(result.text).toBeNull()
    expect(result.allNoSpeech).toBe(false)
  })
})

describe('transcribeAudio', () => {
  test('passes language, temperature 0 and the French prompt to Groq', async () => {
    await localTranscriptionService.transcribeAudio(Buffer.from('audio'), {
      asrModel: 'whisper-large-v3',
      language: 'fr',
      vocabulary: ['gRPC'],
    })

    const args = mockTranscriptionsCreate.mock.calls[0][0]
    expect(args.language).toBe('fr')
    expect(args.temperature).toBe(0)
    expect(args.model).toBe('whisper-large-v3')
    expect(args.prompt).toContain('Vocabulaire : gRPC.')
  })

  test('omits language when empty (auto-detect)', async () => {
    await localTranscriptionService.transcribeAudio(Buffer.from('audio'), {
      asrModel: 'whisper-large-v3',
      language: '',
    })

    const args = mockTranscriptionsCreate.mock.calls[0][0]
    expect('language' in args).toBe(false)
  })

  test('throws NO_SPEECH when every segment is silence', async () => {
    mockTranscriptionsCreate.mockResolvedValue({
      text: 'Merci',
      segments: [{ text: 'Merci', no_speech_prob: 0.99, avg_logprob: -0.8 }],
    })

    await expect(
      localTranscriptionService.transcribeAudio(Buffer.from('audio'), {
        asrModel: 'whisper-large-v3',
      }),
    ).rejects.toMatchObject({ code: 'NO_SPEECH' })
  })

  test('maps HTTP 429 to RATE_LIMIT with retry delay', async () => {
    mockTranscriptionsCreate.mockRejectedValue(
      Object.assign(new Error('Too many requests'), {
        status: 429,
        headers: { 'retry-after': '7' },
      }),
    )

    await expect(
      localTranscriptionService.transcribeAudio(Buffer.from('audio'), {
        asrModel: 'whisper-large-v3',
      }),
    ).rejects.toMatchObject({ code: 'RATE_LIMIT', retryAfterMs: 7000 })
  })

  test('maps HTTP 401 to INVALID_API_KEY', async () => {
    mockTranscriptionsCreate.mockRejectedValue(
      Object.assign(new Error('Unauthorized'), { status: 401 }),
    )

    await expect(
      localTranscriptionService.transcribeAudio(Buffer.from('audio'), {
        asrModel: 'whisper-large-v3',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_API_KEY' })
  })

  test('maps HTTP 500 to NETWORK', async () => {
    mockTranscriptionsCreate.mockRejectedValue(
      Object.assign(new Error('Internal server error'), { status: 500 }),
    )

    await expect(
      localTranscriptionService.transcribeAudio(Buffer.from('audio'), {
        asrModel: 'whisper-large-v3',
      }),
    ).rejects.toMatchObject({ code: 'NETWORK' })
  })

  test('errors carry the LocalTranscriptionError name', async () => {
    mockTranscriptionsCreate.mockRejectedValue(
      Object.assign(new Error('boom'), { status: 500 }),
    )
    try {
      await localTranscriptionService.transcribeAudio(Buffer.from('audio'), {
        asrModel: 'whisper-large-v3',
      })
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(LocalTranscriptionError)
    }
  })
})
