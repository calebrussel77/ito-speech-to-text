import { describe, test, expect, mock, beforeEach } from 'bun:test'

const openRouterCalls: any[] = []
let openRouterReply: (messages: any[]) => string = () => ''
mock.module('./OpenRouterChatService', () => ({
  openRouterChatService: {
    complete: mock(async (options: any) => {
      openRouterCalls.push(options)
      return openRouterReply(options.messages)
    }),
  },
}))
const groqCalls: any[] = []
mock.module('./LocalTranscriptionService', () => ({
  localTranscriptionService: {
    initialize: () => {},
    complete: mock(async (options: any) => {
      groqCalls.push(options)
      return options.messages[1].content
    }),
  },
  LocalTranscriptionError: class extends Error {},
}))

const { polishDialogue, polishPlainText } = await import('./dialoguePolish')

const settings = (overrides: Record<string, unknown> = {}) =>
  ({
    textModelKey: 'gemini-3-7-flash',
    openRouterApiKey: 'or-test',
    groqApiKey: 'gsk',
    llm: {},
    ...overrides,
  }) as any

const segment = (speaker: number, text: string) => ({
  speaker,
  label: `Speaker ${speaker + 1}`,
  startMs: 0,
  endMs: 0,
  text,
})

describe('polishDialogue', () => {
  beforeEach(() => {
    openRouterCalls.length = 0
    groqCalls.length = 0
    // Echo each numbered line back, with one known ASR error fixed.
    openRouterReply = messages =>
      String(messages[1].content)
        .split('\n')
        .map(line => line.replace('influence zoo', 'Nfluenzo'))
        .join('\n')
  })

  test('corrects words turn by turn and keeps speakers, order and count', async () => {
    const segments = [
      segment(0, 'on a testé influence zoo hier'),
      segment(1, "d'accord"),
    ]
    const polished = await polishDialogue(segments, ['Nfluenzo'], settings())

    expect(polished.map(s => s.text)).toEqual([
      'on a testé Nfluenzo hier',
      "d'accord",
    ])
    expect(polished.map(s => s.speaker)).toEqual([0, 1])
    const system = openRouterCalls[0].messages[0].content
    expect(system).toContain('Nfluenzo')
    expect(system).toContain('Never')
  })

  test('a malformed answer leaves that block untouched', async () => {
    openRouterReply = () => 'Voici le texte corrigé : tout va bien.'
    const segments = [segment(0, 'a'), segment(1, 'b')]
    expect(await polishDialogue(segments, [], settings())).toEqual(segments)
  })

  test('a failing model leaves the transcript untouched', async () => {
    openRouterReply = () => {
      throw new Error('boom')
    }
    const segments = [segment(0, 'a')]
    expect(await polishDialogue(segments, [], settings())).toEqual(segments)
  })

  test('long transcripts are proofread in blocks, in order', async () => {
    const segments = Array.from({ length: 95 }, (_, i) =>
      segment(i % 2, `tour ${i}`),
    )
    const polished = await polishDialogue(segments, [], settings())
    expect(openRouterCalls).toHaveLength(3)
    expect(polished.map(s => s.text)).toEqual(segments.map(s => s.text))
  })

  test('a Groq text model is used through Groq', async () => {
    await polishDialogue(
      [segment(0, 'x')],
      [],
      settings({ textModelKey: 'gpt-oss-20b-groq' }),
    )
    expect(groqCalls).toHaveLength(1)
    expect(openRouterCalls).toHaveLength(0)
  })
})

describe('polishPlainText', () => {
  test('splits a memo into sentences, proofreads them, and joins them back', async () => {
    openRouterReply = messages =>
      String(messages[1].content).replace('influence zoo', 'Nfluenzo')
    const text = 'On a vu influence zoo. Ensuite on a parlé prix.'
    expect(await polishPlainText(text, ['Nfluenzo'], settings())).toBe(
      'On a vu Nfluenzo. Ensuite on a parlé prix.',
    )
  })
})
