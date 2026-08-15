import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test'
import {
  openaiTranscriptionService,
  toSpeakerSegments,
  OPENAI_MAX_BYTES,
} from './OpenAITranscriptionService'

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
  responder = () => respondJson({ text: 'transcript' })
  globalThis.fetch = mock(async (url: any, init: any) => {
    calls.push({ url: String(url), init })
    return responder(String(url), init)
  }) as any
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

const formOf = (call: Call) => call.init.body as FormData

describe('toSpeakerSegments', () => {
  test('indexes speakers by first appearance and converts seconds to ms', () => {
    // L'API rend des lettres ("A", "B"…) et des secondes flottantes ; le reste
    // de l'app manipule des index numériques et des millisecondes.
    const segments = toSpeakerSegments([
      { speaker: 'B', start: 0.1, end: 0.65, text: ' Bonjour,' },
      { speaker: 'A', start: 1.15, end: 4.35, text: '   ' },
      { speaker: 'A', start: 5.0, end: 6.6, text: ' Salut.' },
      { speaker: 'B', start: 7.0, end: 8.0, text: 'Encore moi.' },
    ])

    expect(segments).toEqual([
      { speaker: 0, label: 'Speaker 1', startMs: 100, endMs: 650, text: 'Bonjour,' },
      { speaker: 1, label: 'Speaker 2', startMs: 5000, endMs: 6600, text: 'Salut.' },
      { speaker: 0, label: 'Speaker 1', startMs: 7000, endMs: 8000, text: 'Encore moi.' },
    ])
  })

  test('an unexpected speaker id still gets a stable index, never NaN', () => {
    const segments = toSpeakerSegments([
      { speaker: 'unknown' as any, start: 0, end: 1, text: 'a' },
      { speaker: 'unknown' as any, start: 1, end: 2, text: 'b' },
    ])
    expect(segments[0].speaker).toBe(0)
    expect(segments[1].speaker).toBe(0)
  })
})

describe('openaiTranscriptionService.transcribeAudio', () => {
  const audio = Buffer.from('fake audio bytes')
  const options = {
    apiKey: 'sk-test',
    model: 'gpt-transcribe',
    contentType: 'audio/mp4',
    fileName: 'meeting.m4a',
  }

  test('posts multipart to the transcriptions endpoint with a Bearer key', async () => {
    await openaiTranscriptionService.transcribeAudio(audio, options)

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://api.openai.com/v1/audio/transcriptions')
    expect((calls[0].init.headers as any).Authorization).toBe('Bearer sk-test')
    const form = formOf(calls[0])
    expect(form.get('model')).toBe('gpt-transcribe')
    expect((form.get('file') as File).name).toBe('meeting.m4a')
  })

  test('speaks each model’s language dialect: languages[] vs language', async () => {
    // La doc interdit d'envoyer les deux : gpt-transcribe attend `languages[]`,
    // la famille gpt-4o `language`. Vérifié contre l'API réelle (2026-08-15).
    await openaiTranscriptionService.transcribeAudio(audio, {
      ...options,
      language: 'fr',
    })
    expect(formOf(calls[0]).get('languages[]')).toBe('fr')
    expect(formOf(calls[0]).get('language')).toBeNull()

    await openaiTranscriptionService.transcribeAudio(audio, {
      ...options,
      model: 'gpt-4o-transcribe',
      language: 'fr',
    })
    expect(formOf(calls[1]).get('language')).toBe('fr')
    expect(formOf(calls[1]).get('languages[]')).toBeNull()
  })

  test('only the diarize model is asked for diarized_json', async () => {
    // `diarize: true` arrive pour TOUS les fichiers importés (le chemin diarise
    // toujours) — l'envoyer à un modèle qui ne le supporte pas ferait échouer
    // la requête au lieu de rendre un transcript simple.
    await openaiTranscriptionService.transcribeAudio(audio, {
      ...options,
      diarize: true,
    })
    expect(formOf(calls[0]).get('response_format')).toBeNull()

    await openaiTranscriptionService.transcribeAudio(audio, {
      ...options,
      model: 'gpt-4o-transcribe-diarize',
      diarize: true,
    })
    expect(formOf(calls[1]).get('response_format')).toBe('diarized_json')
    expect(formOf(calls[1]).get('chunking_strategy')).toBe('auto')
  })

  test('turns the diarized payload into speaker segments', async () => {
    responder = () =>
      respondJson({
        text: 'Bonjour, salut.',
        segments: [
          { type: 'transcript.text.segment', text: ' Bonjour,', speaker: 'A', start: 0.1, end: 0.65, id: 'seg_0' },
          { type: 'transcript.text.segment', text: ' salut.', speaker: 'B', start: 1.0, end: 2.0, id: 'seg_1' },
        ],
      })

    const result = await openaiTranscriptionService.transcribeAudio(audio, {
      ...options,
      model: 'gpt-4o-transcribe-diarize',
      diarize: true,
    })

    expect(result.segments).toHaveLength(2)
    expect(result.segments[0]).toMatchObject({ speaker: 0, label: 'Speaker 1' })
    expect(result.text).toBe('Bonjour, salut.')
  })

  test('keeps the text when the diarized payload has no segments', async () => {
    responder = () => respondJson({ text: 'un monologue' })

    const result = await openaiTranscriptionService.transcribeAudio(audio, {
      ...options,
      model: 'gpt-4o-transcribe-diarize',
      diarize: true,
    })

    expect(result.text).toBe('un monologue')
    expect(result.segments).toEqual([])
  })

  test('rejects a missing key before touching the network', async () => {
    await expect(
      openaiTranscriptionService.transcribeAudio(audio, {
        ...options,
        apiKey: '   ',
      }),
    ).rejects.toThrow(/OpenAI API key/)
    expect(calls).toHaveLength(0)
  })

  test('refuses a file over 25 MB with the reason, before uploading it', async () => {
    // L'API le refuserait après l'envoi complet — autant le dire tout de
    // suite, avec la sortie de secours (Deepgram ou Gemini).
    const big = Buffer.alloc(OPENAI_MAX_BYTES + 1, 1)
    await expect(
      openaiTranscriptionService.transcribeAudio(big, options),
    ).rejects.toThrow(/25 MB/)
    expect(calls).toHaveLength(0)
  })

  test('reports a refused key as such, not as a generic failure', async () => {
    responder = () => respondJson({ error: { message: 'bad key' } }, 401)

    await expect(
      openaiTranscriptionService.transcribeAudio(audio, options),
    ).rejects.toMatchObject({ code: 'INVALID_API_KEY' })
  })

  test('an empty answer is a failure, not an empty transcript', async () => {
    responder = () => respondJson({ text: '   ' })

    await expect(
      openaiTranscriptionService.transcribeAudio(audio, options),
    ).rejects.toThrow(/returned nothing/)
  })
})
