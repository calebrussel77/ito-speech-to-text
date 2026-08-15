import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test'
import {
  googleTranscriptionService,
  parseClock,
  toSpeakerSegments,
} from './GoogleTranscriptionService'

const originalFetch = globalThis.fetch

type Call = { url: string; init: RequestInit }
let calls: Call[] = []
let responder: (url: string, init: RequestInit) => Response

const respondJson = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })

beforeEach(() => {
  calls = []
  responder = () => respondJson({ output_text: 'transcript' })
  globalThis.fetch = mock(async (url: any, init: any) => {
    calls.push({ url: String(url), init })
    return responder(String(url), init)
  }) as any
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

const bodyOf = (call: Call) => JSON.parse(String(call.init.body))

describe('parseClock', () => {
  test('reads MM:SS and HH:MM:SS', () => {
    expect(parseClock('00:00')).toBe(0)
    expect(parseClock('01:30')).toBe(90_000)
    expect(parseClock('1:02:03')).toBe(3_723_000)
  })

  test('an unreadable timestamp is 0, never NaN', () => {
    // Un horodatage faux décale un segment ; un NaN casse tout l'affichage de
    // l'historique, qui formate ces valeurs sans les revalider.
    expect(parseClock('later')).toBe(0)
    expect(parseClock('')).toBe(0)
    expect(parseClock(undefined as any)).toBe(0)
  })
})

describe('toSpeakerSegments', () => {
  test('numbers the labels from one and drops empty segments', () => {
    const segments = toSpeakerSegments([
      { speaker: 0, start: '00:00', end: '00:04', text: 'bonjour' },
      { speaker: 1, start: '00:04', end: '00:06', text: '   ' },
      { speaker: 1, start: '00:06', end: '00:09', text: 'salut' },
    ])

    expect(segments).toEqual([
      {
        speaker: 0,
        label: 'Speaker 1',
        startMs: 0,
        endMs: 4000,
        text: 'bonjour',
      },
      {
        speaker: 1,
        label: 'Speaker 2',
        startMs: 6000,
        endMs: 9000,
        text: 'salut',
      },
    ])
  })
})

describe('googleTranscriptionService.transcribeAudio', () => {
  const audio = Buffer.from('fake audio bytes')
  const options = {
    apiKey: 'AIza-test',
    model: 'gemini-3.7-flash',
    contentType: 'audio/mp4',
  }

  test('posts to the interactions endpoint with the key in the header', async () => {
    await googleTranscriptionService.transcribeAudio(audio, options)

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/interactions',
    )
    expect((calls[0].init.headers as any)['x-goog-api-key']).toBe('AIza-test')
    const body = bodyOf(calls[0])
    expect(body.model).toBe('gemini-3.7-flash')
    expect(body.input[1]).toMatchObject({
      type: 'audio',
      mime_type: 'audio/mp4',
    })
    expect(body.input[1].data).toBe(audio.toString('base64'))
  })

  test('forbids anything but a transcript through the system instruction', async () => {
    // Gemini n'est pas un ASR : sans cette consigne il répond au contenu, le
    // résume, ou refuse. C'est la seule protection contre ça.
    await googleTranscriptionService.transcribeAudio(audio, options)

    const body = bodyOf(calls[0])
    expect(body.system_instruction).toContain('transcribe')
    expect(body.system_instruction).toMatch(/never (answer|summarise)/i)
  })

  test('asks for structured JSON only when diarization is wanted', async () => {
    await googleTranscriptionService.transcribeAudio(audio, options)
    expect(bodyOf(calls[0]).response_format).toBeUndefined()

    await googleTranscriptionService.transcribeAudio(audio, {
      ...options,
      diarize: true,
    })
    const format = bodyOf(calls[1]).response_format
    expect(format.mime_type).toBe('application/json')
    expect(format.schema.properties.segments).toBeDefined()
  })

  test('turns the diarized JSON into speaker segments', async () => {
    responder = () =>
      respondJson({
        output_text: JSON.stringify({
          segments: [
            { speaker: 0, start: '00:00', end: '00:03', text: 'bonjour' },
            { speaker: 1, start: '00:03', end: '00:05', text: 'salut' },
          ],
        }),
      })

    const result = await googleTranscriptionService.transcribeAudio(audio, {
      ...options,
      diarize: true,
    })

    expect(result.segments).toHaveLength(2)
    expect(result.text).toBe('bonjour salut')
  })

  test('keeps free text when the model ignores the schema', async () => {
    // Une sortie non conforme ne doit pas perdre la transcription : on rend ce
    // qui a été dit, sans les locuteurs, plutôt que de lever après plusieurs
    // minutes de traitement.
    responder = () => respondJson({ output_text: 'bonjour salut' })

    const result = await googleTranscriptionService.transcribeAudio(audio, {
      ...options,
      diarize: true,
    })

    expect(result.text).toBe('bonjour salut')
    expect(result.segments).toEqual([])
  })

  test('reads the text from the steps when output_text is absent', async () => {
    responder = () =>
      respondJson({
        steps: [
          { type: 'model_output', content: [{ type: 'text', text: 'ok' }] },
        ],
      })

    const result = await googleTranscriptionService.transcribeAudio(
      audio,
      options,
    )
    expect(result.text).toBe('ok')
  })

  test('uploads through the Files API when the audio is too big to inline', async () => {
    // Une réunion d'une heure dépasse largement le corps de requête autorisé :
    // sans ce chemin, le cas qui a motivé Gemini est justement celui qui casse.
    const big = Buffer.alloc(13 * 1024 * 1024, 1)
    responder = url => {
      if (url.includes('/upload/')) {
        return new Response('', {
          status: 200,
          headers: { 'x-goog-upload-url': 'https://upload.example/session' },
        })
      }
      if (url === 'https://upload.example/session') {
        return respondJson({ file: { uri: 'files/abc123' } })
      }
      return respondJson({ output_text: 'transcript' })
    }

    await googleTranscriptionService.transcribeAudio(big, options)

    expect(calls).toHaveLength(3)
    const body = bodyOf(calls[2])
    expect(body.input[1]).toEqual({
      type: 'audio',
      uri: 'files/abc123',
      mime_type: 'audio/mp4',
    })
    expect(body.input[1].data).toBeUndefined()
  })

  test('rejects a missing key before touching the network', async () => {
    await expect(
      googleTranscriptionService.transcribeAudio(audio, {
        ...options,
        apiKey: '   ',
      }),
    ).rejects.toThrow(/Google API key/)
    expect(calls).toHaveLength(0)
  })

  test('reports a refused key as such, not as a generic failure', async () => {
    responder = () => respondJson({ error: 'bad key' }, 403)

    await expect(
      googleTranscriptionService.transcribeAudio(audio, options),
    ).rejects.toMatchObject({ code: 'INVALID_API_KEY' })
  })

  test('an empty answer is a failure, not an empty transcript', async () => {
    responder = () => respondJson({ output_text: '   ' })

    await expect(
      googleTranscriptionService.transcribeAudio(audio, options),
    ).rejects.toThrow(/returned nothing/)
  })
})
