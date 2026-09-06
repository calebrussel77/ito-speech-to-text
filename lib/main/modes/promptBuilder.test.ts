import { describe, test, expect, mock, beforeEach } from 'bun:test'

let examples: any[] = []
mock.module('./ModeRepository', () => ({
  ModeExamplesTable: { findByMode: async () => examples },
}))

const { buildMessages } = await import('./promptBuilder')

const mode = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 'intelligent',
    name: 'Intelligent',
    instructions: '## Role\nYou format text.',
    language: 'fr',
    useLlm: true,
    contextApplication: false,
    contextClipboard: false,
    contextSelection: false,
    ...overrides,
  }) as any

const context = (overrides: Record<string, unknown> = {}) =>
  ({
    vocabularyWords: [],
    dictionaryEntries: [],
    windowTitle: '',
    appName: '',
    contextText: '',
    clipboardText: '',
    advancedSettings: {},
    ...overrides,
  }) as any

describe('buildMessages', () => {
  beforeEach(() => {
    examples = []
  })

  test('instructions go to the system message, the dictation is the last user message', async () => {
    const messages = await buildMessages('hello there', mode(), context())

    expect(messages[0].role).toBe('system')
    expect(messages[0].content).toContain('## Role')
    expect(messages.at(-1)).toEqual({ role: 'user', content: 'hello there' })
  })

  test('an explicit language is imposed on the output', async () => {
    const messages = await buildMessages(
      'x',
      mode({ language: 'es' }),
      context(),
    )
    expect(messages[0].content).toContain('Always write the result in Spanish')
  })

  test('automatic imposes nothing and asks for the dictated language', async () => {
    const messages = await buildMessages(
      'x',
      mode({ language: 'auto' }),
      context(),
    )
    expect(messages[0].content).not.toContain('Always write the result in')
    expect(messages[0].content).toContain('same language as the user message')
  })

  test('examples become real conversation turns, in order, before the dictation', async () => {
    examples = [
      {
        spokenInput: 'buy milk eggs no not eggs cheese',
        aiOutput: '- Milk\n- Cheese',
      },
      {
        spokenInput: 'write an article no an essay',
        aiOutput: 'Write an essay.',
      },
    ]

    const messages = await buildMessages('x', mode(), context())

    expect(messages.map(m => m.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
      'assistant',
      'user',
    ])
    expect(messages[1].content).toBe('buy milk eggs no not eggs cheese')
    expect(messages[2].content).toBe('- Milk\n- Cheese')
    expect(messages.at(-1)!.content).toBe('x')
  })

  test('an example missing one half is dropped rather than teaching an empty answer', async () => {
    examples = [
      { spokenInput: 'complete', aiOutput: 'ok' },
      { spokenInput: 'orphan', aiOutput: '   ' },
      { spokenInput: '', aiOutput: 'orphan too' },
    ]

    const messages = await buildMessages('x', mode(), context())
    expect(messages.map(m => m.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
    ])
  })

  test('enabled contexts are labelled and precede the dictation in the same message', async () => {
    const messages = await buildMessages(
      'continue this',
      mode({
        contextApplication: true,
        contextClipboard: true,
        contextSelection: true,
      }),
      context({
        appName: 'Cursor',
        windowTitle: 'plan.md',
        clipboardText: 'clip',
        contextText: 'selected',
      }),
    )

    const last = messages.at(-1)!.content
    expect(last).toContain('<application_context>')
    expect(last).toContain('Cursor')
    expect(last).toContain('plan.md')
    expect(last).toContain('<copied_text>')
    expect(last).toContain('clip')
    expect(last).toContain('<selected_text>')
    expect(last).toContain('selected')
    // La dictée ferme le message : c'est elle que le modèle doit traiter.
    expect(last.trimEnd().endsWith('continue this')).toBe(true)
  })

  test('low-confidence passages are a labelled context block, never a mark in the dictation', async () => {
    const messages = await buildMessages(
      'du coup le composant satingues',
      mode(),
      context({ lowConfidenceSegments: ['satingues', ' '] }),
    )
    const user = messages[messages.length - 1].content
    expect(user).toContain('<low_confidence_segments>')
    expect(user).toContain('- satingues')
    expect(user.endsWith('du coup le composant satingues')).toBe(true)

    const plain = await buildMessages('x', mode(), context())
    expect(plain[plain.length - 1].content).toBe('x')
  })

  test('a context that is switched on but empty adds no block', async () => {
    const messages = await buildMessages(
      'x',
      mode({ contextClipboard: true }),
      context({ clipboardText: '' }),
    )
    expect(messages.at(-1)!.content).not.toContain('<copied_text>')
  })

  test('empty instructions fall back rather than sending an empty system message', async () => {
    const messages = await buildMessages(
      'x',
      mode({ instructions: '' }),
      context(),
    )
    expect(messages[0].content.length).toBeGreaterThan(20)
  })
})
