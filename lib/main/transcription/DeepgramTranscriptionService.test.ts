import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import {
  deepgramTranscriptionService,
  groupWordsBySpeaker,
} from './DeepgramTranscriptionService'

const originalFetch = globalThis.fetch

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

const withWords = (words: unknown[]) => ({
  results: {
    channels: [
      {
        alternatives: [
          {
            transcript: words
              .map((w: any) => w.punctuated_word || w.word)
              .join(' '),
            words,
          },
        ],
      },
    ],
  },
})

let fetchMock: ReturnType<typeof mock>

const lastRequest = () => {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit]
  return { url: String(url), init }
}

describe('DeepgramTranscriptionService', () => {
  beforeEach(() => {
    fetchMock = mock(() =>
      Promise.resolve(
        jsonResponse(withWords([{ word: 'bonjour', start: 0, end: 0.5 }])),
      ),
    )
    globalThis.fetch = fetchMock as any
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('sends the raw WAV bytes, never base64 — that is the whole point of this path', async () => {
    await deepgramTranscriptionService.transcribeAudio(Buffer.from('RIFFwav'), {
      apiKey: 'dg-test',
      model: 'nova-3',
      language: 'fr',
    })

    const { url, init } = lastRequest()
    expect(init.method).toBe('POST')
    expect((init.headers as any).Authorization).toBe('Token dg-test')
    expect((init.headers as any)['Content-Type']).toBe('audio/wav')
    expect(Buffer.isBuffer(init.body)).toBe(true)
    expect(url).toContain('model=nova-3')
    expect(url).toContain('language=fr')
  })

  test('automatic language sends no language parameter', async () => {
    await deepgramTranscriptionService.transcribeAudio(Buffer.from('x'), {
      apiKey: 'dg',
      model: 'nova-3',
    })
    expect(lastRequest().url).not.toContain('language=')
  })

  test('diarization is only requested when asked for', async () => {
    await deepgramTranscriptionService.transcribeAudio(Buffer.from('x'), {
      apiKey: 'dg',
      model: 'nova-3',
      diarize: true,
    })
    expect(lastRequest().url).toContain('diarize=true')

    await deepgramTranscriptionService.transcribeAudio(Buffer.from('x'), {
      apiKey: 'dg',
      model: 'nova-3',
    })
    expect(lastRequest().url).not.toContain('diarize')
  })

  test('groups consecutive words by speaker into segments, preferring punctuated_word', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        withWords([
          {
            word: 'bonjour',
            punctuated_word: 'Bonjour',
            start: 0,
            end: 0.5,
            speaker: 0,
            confidence: 0.9,
            speaker_confidence: 1,
          },
          {
            word: 'tout',
            punctuated_word: 'tout',
            start: 0.5,
            end: 0.8,
            speaker: 0,
          },
          {
            word: 'le',
            punctuated_word: 'le',
            start: 0.8,
            end: 0.9,
            speaker: 0,
          },
          {
            word: 'salut',
            punctuated_word: 'Salut',
            start: 1.2,
            end: 1.6,
            speaker: 1,
          },
          {
            word: 'oui',
            punctuated_word: 'oui.',
            start: 2.0,
            end: 2.2,
            speaker: 0,
          },
        ]),
      ),
    )

    const result = await deepgramTranscriptionService.transcribeAudio(
      Buffer.from('x'),
      { apiKey: 'dg', model: 'nova-3', diarize: true },
    )

    expect(result.segments).toEqual([
      {
        speaker: 0,
        label: 'Speaker 1',
        startMs: 0,
        endMs: 900,
        text: 'Bonjour tout le',
      },
      {
        speaker: 1,
        label: 'Speaker 2',
        startMs: 1200,
        endMs: 1600,
        text: 'Salut',
      },
      {
        speaker: 0,
        label: 'Speaker 1',
        startMs: 2000,
        endMs: 2200,
        text: 'oui.',
      },
    ])
  })

  test('falls back to the bare word when punctuated_word is absent', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        withWords([
          { word: 'bonjour', start: 0, end: 0.5, speaker: 0 },
          { word: 'monde', start: 0.5, end: 0.9, speaker: 0 },
        ]),
      ),
    )

    const result = await deepgramTranscriptionService.transcribeAudio(
      Buffer.from('x'),
      { apiKey: 'dg', model: 'nova-3', diarize: true },
    )

    expect(result.segments).toEqual([
      {
        speaker: 0,
        label: 'Speaker 1',
        startMs: 0,
        endMs: 900,
        text: 'bonjour monde',
      },
    ])
  })

  test('groupWordsBySpeaker([]) returns [] without throwing', () => {
    expect(groupWordsBySpeaker([])).toEqual([])
  })

  test('without diarization there are no segments, only text', async () => {
    const result = await deepgramTranscriptionService.transcribeAudio(
      Buffer.from('x'),
      { apiKey: 'dg', model: 'nova-3' },
    )

    expect(result.text).toBe('bonjour')
    expect(result.segments).toEqual([])
  })

  test('a refused key is reported as INVALID_API_KEY, not as a network glitch', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ err_msg: 'Invalid credentials' }, 401),
    )

    await expect(
      deepgramTranscriptionService.transcribeAudio(Buffer.from('x'), {
        apiKey: 'bad',
        model: 'nova-3',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_API_KEY' })
  })

  test('maps 429 to RATE_LIMIT', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ err_msg: 'slow down' }, 429))

    await expect(
      deepgramTranscriptionService.transcribeAudio(Buffer.from('x'), {
        apiKey: 'dg',
        model: 'nova-3',
      }),
    ).rejects.toMatchObject({ code: 'RATE_LIMIT' })
  })

  test('a 429 with Retry-After surfaces it as retryAfterMs', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ err_msg: 'slow down' }), {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': '5',
        },
      }),
    )

    await expect(
      deepgramTranscriptionService.transcribeAudio(Buffer.from('x'), {
        apiKey: 'dg',
        model: 'nova-3',
      }),
    ).rejects.toMatchObject({ code: 'RATE_LIMIT', retryAfterMs: 5000 })
  })

  test('a 429 without Retry-After still maps to RATE_LIMIT with no bogus delay', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ err_msg: 'slow down' }, 429))

    await expect(
      deepgramTranscriptionService.transcribeAudio(Buffer.from('x'), {
        apiKey: 'dg',
        model: 'nova-3',
      }),
    ).rejects.toMatchObject({ code: 'RATE_LIMIT', retryAfterMs: undefined })
  })

  test('maps 5xx to NETWORK', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ err_msg: 'boom' }, 503))

    await expect(
      deepgramTranscriptionService.transcribeAudio(Buffer.from('x'), {
        apiKey: 'dg',
        model: 'nova-3',
      }),
    ).rejects.toMatchObject({ code: 'NETWORK' })
  })

  test('maps fetch failures (offline) to NETWORK', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))

    await expect(
      deepgramTranscriptionService.transcribeAudio(Buffer.from('x'), {
        apiKey: 'dg',
        model: 'nova-3',
      }),
    ).rejects.toMatchObject({ code: 'NETWORK' })
  })

  test('a missing key never reaches the network', async () => {
    await expect(
      deepgramTranscriptionService.transcribeAudio(Buffer.from('x'), {
        apiKey: '  ',
        model: 'nova-3',
      }),
    ).rejects.toMatchObject({ code: 'MISSING_API_KEY' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('an empty transcript on real audio is an error, not a silent success', async () => {
    fetchMock.mockResolvedValue(jsonResponse(withWords([])))

    await expect(
      deepgramTranscriptionService.transcribeAudio(Buffer.from('x'), {
        apiKey: 'dg',
        model: 'nova-3',
      }),
    ).rejects.toMatchObject({ code: 'MODEL_ERROR' })
  })

  test('testConnection reports invalid keys', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 401))
    const result = await deepgramTranscriptionService.testConnection('dg-bad')
    expect(result.ok).toBe(false)
  })

  test('testConnection reports success', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ projects: [] }))
    const result = await deepgramTranscriptionService.testConnection('dg-ok')
    expect(result.ok).toBe(true)
  })

  test('testConnection requires a key before hitting the network', async () => {
    const result = await deepgramTranscriptionService.testConnection('  ')
    expect(result.ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
