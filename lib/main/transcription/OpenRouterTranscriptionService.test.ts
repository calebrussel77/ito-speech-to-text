import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import { openRouterTranscriptionService } from './OpenRouterTranscriptionService'

const originalFetch = globalThis.fetch

const jsonResponse = (
  body: unknown,
  status = 200,
  headers?: Record<string, string>,
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })

let fetchMock: ReturnType<typeof mock>

const lastRequestBody = () => {
  const [, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit]
  return JSON.parse(init.body as string)
}

describe('OpenRouterTranscriptionService', () => {
  beforeEach(() => {
    fetchMock = mock(() =>
      Promise.resolve(
        jsonResponse({ text: 'bonjour', usage: { cost: 0.001 } }),
      ),
    )
    globalThis.fetch = fetchMock as any
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('requires an API key', async () => {
    await expect(
      openRouterTranscriptionService.transcribeAudio(Buffer.from('wav'), {
        apiKey: '',
      }),
    ).rejects.toMatchObject({ code: 'MISSING_API_KEY' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('returns the transcript on success', async () => {
    const text = await openRouterTranscriptionService.transcribeAudio(
      Buffer.from('wav'),
      { apiKey: 'sk-or-test' },
    )
    expect(text).toBe('bonjour')
  })

  test('gpt-transcribe gets prompt, keywords and plural languages hints', async () => {
    await openRouterTranscriptionService.transcribeAudio(Buffer.from('wav'), {
      apiKey: 'sk-or-test',
      model: 'openai/gpt-transcribe',
      vocabulary: ['Chariow', 'Nfluenzo'],
      language: 'fr',
    })

    const body = lastRequestBody()
    expect(body.model).toBe('openai/gpt-transcribe')
    expect(body.temperature).toBe(0)
    expect(body.input_audio.format).toBe('wav')
    expect(body.provider.options.openai.keywords).toEqual([
      'Chariow',
      'Nfluenzo',
    ])
    expect(body.provider.options.openai.languages).toEqual(['fr', 'en'])
    expect(body.provider.options.openai.prompt).toBeTruthy()
    // gpt-transcribe declares languages via provider options, not top-level
    expect(body.language).toBeUndefined()
  })

  test('voxtral gets top-level language and context_bias hints', async () => {
    await openRouterTranscriptionService.transcribeAudio(Buffer.from('wav'), {
      apiKey: 'sk-or-test',
      model: 'mistralai/voxtral-mini-transcribe',
      vocabulary: ['Chariow'],
      language: 'fr',
    })

    const body = lastRequestBody()
    expect(body.language).toBe('fr')
    expect(body.provider.options.mistral.context_bias).toEqual(['Chariow'])
  })

  test('caps hint lists at 100 terms', async () => {
    const vocabulary = Array.from({ length: 150 }, (_, i) => `term${i}`)
    await openRouterTranscriptionService.transcribeAudio(Buffer.from('wav'), {
      apiKey: 'sk-or-test',
      model: 'openai/gpt-transcribe',
      vocabulary,
    })
    expect(lastRequestBody().provider.options.openai.keywords).toHaveLength(100)
  })

  test('maps 401 to INVALID_API_KEY', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'no' }, 401))
    await expect(
      openRouterTranscriptionService.transcribeAudio(Buffer.from('wav'), {
        apiKey: 'sk-or-bad',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_API_KEY', status: 401 })
  })

  test('maps 429 to RATE_LIMIT with retry-after', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: 'slow down' }, 429, { 'retry-after': '2' }),
    )
    await expect(
      openRouterTranscriptionService.transcribeAudio(Buffer.from('wav'), {
        apiKey: 'sk-or-test',
      }),
    ).rejects.toMatchObject({ code: 'RATE_LIMIT', retryAfterMs: 2000 })
  })

  test('maps 5xx to NETWORK', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'boom' }, 503))
    await expect(
      openRouterTranscriptionService.transcribeAudio(Buffer.from('wav'), {
        apiKey: 'sk-or-test',
      }),
    ).rejects.toMatchObject({ code: 'NETWORK' })
  })

  test('maps fetch failures (offline) to NETWORK', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))
    await expect(
      openRouterTranscriptionService.transcribeAudio(Buffer.from('wav'), {
        apiKey: 'sk-or-test',
      }),
    ).rejects.toMatchObject({ code: 'NETWORK' })
  })

  test('treats an empty transcript as a MODEL_ERROR so the caller falls back', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ text: '   ' }))
    await expect(
      openRouterTranscriptionService.transcribeAudio(Buffer.from('wav'), {
        apiKey: 'sk-or-test',
      }),
    ).rejects.toMatchObject({ code: 'MODEL_ERROR' })
  })

  test('testConnection reports invalid keys', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 401))
    const result =
      await openRouterTranscriptionService.testConnection('sk-or-bad')
    expect(result.ok).toBe(false)
  })

  test('testConnection reports success', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: {} }))
    const result =
      await openRouterTranscriptionService.testConnection('sk-or-ok')
    expect(result.ok).toBe(true)
  })
})
