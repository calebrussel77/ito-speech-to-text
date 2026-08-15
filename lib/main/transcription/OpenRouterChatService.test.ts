import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test'
import { openRouterChatService } from './OpenRouterChatService'

const originalFetch = globalThis.fetch

type Call = { url: string; init: RequestInit }
let calls: Call[] = []
let responder: () => Response

const respondJson = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })

beforeEach(() => {
  calls = []
  responder = () =>
    respondJson({ choices: [{ message: { content: 'texte corrigé' } }] })
  globalThis.fetch = mock(async (url: any, init: any) => {
    calls.push({ url: String(url), init })
    return responder()
  }) as any
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

const OPTIONS = {
  apiKey: 'sk-or-test',
  model: 'qwen/qwen3.7-flash',
  messages: [{ role: 'user' as const, content: 'corrige ceci' }],
}

describe('openRouterChatService.complete', () => {
  test('asks OpenRouter to keep reasoning out of the response', () => {
    // Sans consigne du catalogue, on n'envoie pas d'`effort` : un modèle qui
    // ne raisonne pas peut rejeter le champ.
    return openRouterChatService.complete(OPTIONS).then(() => {
      const body = JSON.parse(String(calls[0].init.body))
      expect(body.reasoning).toEqual({ exclude: true })
    })
  })

  test('forwards the catalogue reasoning effort — none cuts it, low floors it', async () => {
    // Réécrire une dictée est du formatage : chaque seconde de thinking est
    // de la latence pure entre la fin de la dictée et le collage du texte.
    await openRouterChatService.complete({
      ...OPTIONS,
      reasoningEffort: 'none',
    })
    expect(JSON.parse(String(calls[0].init.body)).reasoning).toEqual({
      exclude: true,
      effort: 'none',
    })

    await openRouterChatService.complete({ ...OPTIONS, reasoningEffort: 'low' })
    expect(JSON.parse(String(calls[1].init.body)).reasoning).toEqual({
      exclude: true,
      effort: 'low',
    })
  })

  test('strips an inline think block that the host leaked anyway', async () => {
    // La fuite du 2026-08-15 : certains hôtes Qwen ignorent `exclude` et
    // collent le monologue dans `content` — il finissait DICTÉ dans le
    // document. Le service est le seul point par où toutes les réécritures
    // passent, donc la garantie vit ici.
    responder = () =>
      respondJson({
        choices: [
          {
            message: {
              content:
                '<think>\nLong internal monologue...\n</think>\n\nTexte final propre.',
            },
          },
        ],
      })

    const result = await openRouterChatService.complete(OPTIONS)
    expect(result).toBe('Texte final propre.')
  })

  test('an unclosed think block yields an empty answer, not the reasoning', async () => {
    responder = () =>
      respondJson({
        choices: [{ message: { content: '<think>\ntruncated thinking' } }],
      })

    // '' fait retomber TranscriptAdjuster sur le transcript brut.
    expect(await openRouterChatService.complete(OPTIONS)).toBe('')
  })
})
