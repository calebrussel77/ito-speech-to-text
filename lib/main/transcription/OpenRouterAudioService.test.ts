import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test'
import { openRouterAudioService } from './OpenRouterAudioService'

const originalFetch = globalThis.fetch
type Call = { url: string; init: RequestInit }
let calls: Call[] = []
let responder: (url: string, init: RequestInit) => Response

const respondJson = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
const reply = (content: string) =>
  respondJson({ choices: [{ message: { content } }], provider: 'Google' })

beforeEach(() => {
  calls = []
  responder = () => reply('bonjour')
  globalThis.fetch = mock(async (url: any, init: any) => {
    calls.push({ url: String(url), init })
    return responder(String(url), init)
  }) as any
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

const bodyOf = (call: Call) => JSON.parse(String(call.init.body))
const audio = Buffer.from('mp3-bytes')
const options = {
  apiKey: 'or-test',
  model: 'google/gemini-3.7-flash',
  language: 'fr',
  vocabulary: ['Nfluenzo'],
  format: 'mp3' as const,
}

describe('openRouterAudioService.transcribeAudio', () => {
  test('sends the audio inline in a chat message with the dialogue brief', async () => {
    await openRouterAudioService.transcribeAudio(audio, options)

    expect(calls[0].url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect((calls[0].init.headers as any).Authorization).toBe('Bearer or-test')
    const body = bodyOf(calls[0])
    expect(body.model).toBe('google/gemini-3.7-flash')
    expect(body.messages[0].role).toBe('system')
    expect(body.messages[0].content).toContain('Locuteur 1')
    expect(body.messages[0].content).toContain('Nfluenzo')
    const audioPart = body.messages[1].content.find(
      (part: any) => part.type === 'input_audio',
    )
    expect(audioPart.input_audio).toEqual({
      data: audio.toString('base64'),
      format: 'mp3',
    })
    expect(body.reasoning).toEqual({ effort: 'low' })
  })

  test('turns a labelled dialogue into speaker segments', async () => {
    responder = () =>
      reply('[00:00:00] Locuteur 1 : bonjour\n[00:00:04] Locuteur 2 : salut')

    const result = await openRouterAudioService.transcribeAudio(audio, options)

    expect(result.segments.map(s => s.speaker)).toEqual([0, 1])
    expect(result.text).toBe('bonjour salut')
  })

  test('a single voice comes back as plain text', async () => {
    responder = () => reply('Mémo du jour, rien de plus.')
    const result = await openRouterAudioService.transcribeAudio(audio, options)
    expect(result.segments).toEqual([])
    expect(result.text).toBe('Mémo du jour, rien de plus.')
  })

  test('a refused key, a too-large body and an empty answer are named failures', async () => {
    responder = () => respondJson({ error: 'nope' }, 401)
    await expect(
      openRouterAudioService.transcribeAudio(audio, options),
    ).rejects.toMatchObject({ code: 'INVALID_API_KEY' })

    responder = () => respondJson({ error: 'too big' }, 413)
    await expect(
      openRouterAudioService.transcribeAudio(audio, options),
    ).rejects.toMatchObject({ code: 'MODEL_ERROR' })

    responder = () => reply('')
    await expect(
      openRouterAudioService.transcribeAudio(audio, options),
    ).rejects.toMatchObject({ code: 'MODEL_ERROR' })

    await expect(
      openRouterAudioService.transcribeAudio(audio, { ...options, apiKey: '' }),
    ).rejects.toMatchObject({ code: 'MISSING_API_KEY' })
  })
})
