import { describe, test, expect } from 'bun:test'
import {
  chooseTranscriptionPath,
  FILE_PATH_THRESHOLD_MS,
} from './transcriptionRouter'

const input = (overrides: Record<string, unknown> = {}) => ({
  voiceModelProvider: 'groq' as const,
  durationMs: 30_000,
  wavBytes: 1_000_000,
  identifySpeakers: false,
  hasOpenRouterKey: true,
  hasDeepgramKey: true,
  hasOpenAIKey: true,
  hasGoogleKey: true,
  ...overrides,
})

describe('chooseTranscriptionPath', () => {
  test('a short dictation on a Groq model goes to Groq', () => {
    expect(chooseTranscriptionPath(input())).toEqual({ path: 'groq' })
  })

  test('a short dictation on an OpenRouter model goes to OpenRouter', () => {
    expect(
      chooseTranscriptionPath(input({ voiceModelProvider: 'openrouter' })),
    ).toEqual({ path: 'openrouter' })
  })

  test('a short dictation follows its model provider — one path each', () => {
    // Nova 3 est servi par Deepgram, les GPT Transcribe par OpenAI, les Gemini
    // par Google : le fournisseur du modèle choisi EST le chemin, dès lors que
    // sa clé est là.
    for (const provider of ['deepgram', 'openai', 'google'] as const) {
      expect(
        chooseTranscriptionPath(input({ voiceModelProvider: provider })),
      ).toEqual({ path: provider })
    }
  })

  test('a new-provider model without its key falls back to Groq', () => {
    // Le sélecteur grise déjà ces modèles sans clé : y arriver quand même est
    // un état transitoire (clé effacée après coup), pas un choix — la dictée
    // vaut mieux qu'un refus.
    expect(
      chooseTranscriptionPath(
        input({ voiceModelProvider: 'deepgram', hasDeepgramKey: false }),
      ),
    ).toEqual({ path: 'groq' })
    expect(
      chooseTranscriptionPath(
        input({ voiceModelProvider: 'openai', hasOpenAIKey: false }),
      ),
    ).toEqual({ path: 'groq' })
    expect(
      chooseTranscriptionPath(
        input({ voiceModelProvider: 'google', hasGoogleKey: false }),
      ),
    ).toEqual({ path: 'groq' })
  })

  test('past the threshold, the file path wins whatever the model provider', () => {
    for (const provider of [
      'groq',
      'openrouter',
      'openai',
      'google',
    ] as const) {
      expect(
        chooseTranscriptionPath(
          input({
            voiceModelProvider: provider,
            durationMs: FILE_PATH_THRESHOLD_MS,
          }),
        ),
      ).toEqual({ path: 'deepgram' })
    }
  })

  test('the threshold is well under the Groq byte ceiling — no recording should ever hit it', () => {
    // 8 min at 16 kHz mono 16-bit ≈ 15 MB, against a 25 MB ceiling.
    expect(FILE_PATH_THRESHOLD_MS).toBeLessThan(13 * 60 * 1000)
  })

  test('a long recording without a Deepgram key still tries, as long as it fits', () => {
    expect(
      chooseTranscriptionPath(
        input({
          durationMs: 600_000,
          wavBytes: 19_000_000,
          hasDeepgramKey: false,
        }),
      ),
    ).toEqual({ path: 'groq' })
  })

  test('a long recording with neither a Deepgram key nor room in Groq is refused by name', () => {
    const result = chooseTranscriptionPath(
      input({
        durationMs: 3_600_000,
        wavBytes: 115_000_000,
        hasDeepgramKey: false,
      }),
    )

    expect(result.path).toBeNull()
    expect((result as any).reason).toContain('Deepgram')
  })

  test('an OpenRouter model without its key falls back to Groq', () => {
    expect(
      chooseTranscriptionPath(
        input({ voiceModelProvider: 'openrouter', hasOpenRouterKey: false }),
      ),
    ).toEqual({ path: 'groq' })
  })

  test('an OpenRouter recording too big for base64 goes to the file path', () => {
    expect(
      chooseTranscriptionPath(
        input({
          voiceModelProvider: 'openrouter',
          durationMs: 300_000,
          wavBytes: 10_000_000,
        }),
      ),
    ).toEqual({ path: 'deepgram' })
  })

  test('the byte ceiling follows the provider, not the strictest of them', () => {
    // 10 Mo dépasse le plafond base64 d'OpenRouter mais pas celui de Groq.
    // Appliquer le mauvais ferait changer de moteur une dictée de 5 min sur un
    // modèle Groq, en silence — contraire à D2 et D16.
    expect(
      chooseTranscriptionPath(
        input({
          voiceModelProvider: 'groq',
          durationMs: 300_000,
          wavBytes: 10_000_000,
        }),
      ),
    ).toEqual({ path: 'groq' })
  })

  test('a mode that identifies speakers always takes the file path', () => {
    // Deepgram est le seul chemin qui rend words[].speaker : une réunion de
    // deux minutes doit y aller quand même, sinon la vue Speakers est vide.
    expect(
      chooseTranscriptionPath(
        input({
          durationMs: 120_000,
          wavBytes: 3_800_000,
          identifySpeakers: true,
        }),
      ),
    ).toEqual({ path: 'deepgram' })
  })

  test('speaker identification without a Deepgram key degrades instead of failing', () => {
    expect(
      chooseTranscriptionPath(
        input({
          durationMs: 120_000,
          wavBytes: 3_800_000,
          identifySpeakers: true,
          hasDeepgramKey: false,
        }),
      ),
    ).toEqual({ path: 'groq' })
  })
})
