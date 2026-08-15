import { describe, test, expect, beforeEach, mock } from 'bun:test'

const mockGroqComplete = mock(async (_options: any) => 'groq adjusted')
mock.module('./LocalTranscriptionService', () => ({
  localTranscriptionService: { complete: mockGroqComplete },
  LocalTranscriptionError: class extends Error {},
}))

const mockOpenRouterComplete = mock(
  async (_options: any) => 'openrouter adjusted',
)
mock.module('./OpenRouterChatService', () => ({
  openRouterChatService: { complete: mockOpenRouterComplete },
}))

const { transcriptAdjuster } = await import('./TranscriptAdjuster')

const context = {
  windowTitle: 'Editor',
  appName: 'Code',
  contextText: '',
  clipboardText: '',
  vocabularyWords: [],
  dictionaryEntries: [],
} as any

const mode = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 'intelligent',
    userId: 'self-hosted',
    name: 'Intelligent',
    preset: 'intelligent',
    icon: 'Sparkles',
    instructions: '## Role\nFormat the user message.',
    language: 'fr',
    voiceModelKey: null,
    textModelKey: null,
    useLlm: true,
    contextApplication: false,
    contextClipboard: false,
    contextSelection: false,
    audioSource: 'microphone',
    playbackWhenRecording: 'mute',
    autoPaste: true,
    autocapitalize: true,
    identifySpeakers: false,
    asrPrompt: '',
    sortOrder: 0,
    createdAt: '2026-08-14T00:00:00.000Z',
    updatedAt: '2026-08-14T00:00:00.000Z',
    ...overrides,
  }) as any

const settings = (overrides: Record<string, unknown> = {}) =>
  ({
    llm: { llmTemperature: 0.1 },
    openRouterApiKey: 'sk-or-test',
    ...overrides,
  }) as any

beforeEach(() => {
  mockGroqComplete.mockClear()
  mockGroqComplete.mockResolvedValue('groq adjusted')
  mockOpenRouterComplete.mockClear()
  mockOpenRouterComplete.mockResolvedValue('openrouter adjusted')
})

describe('TranscriptAdjuster', () => {
  test('a mode that does not rewrite never calls a model', async () => {
    const result = await transcriptAdjuster.adjust(
      '  raw transcript  ',
      mode({ useLlm: false, textModelKey: 'gpt-oss-20b-groq' }),
      context,
      settings(),
    )

    expect(result).toBe('raw transcript')
    expect(mockGroqComplete).not.toHaveBeenCalled()
    expect(mockOpenRouterComplete).not.toHaveBeenCalled()
  })

  test('a Groq catalogue key routes to Groq', async () => {
    const result = await transcriptAdjuster.adjust(
      'raw',
      mode({ textModelKey: 'gpt-oss-20b-groq' }),
      context,
      settings(),
    )

    expect(result).toBe('groq adjusted')
    expect(mockOpenRouterComplete).not.toHaveBeenCalled()
    expect(mockGroqComplete).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'openai/gpt-oss-20b' }),
    )
  })

  test('an OpenRouter catalogue key routes to OpenRouter', async () => {
    const result = await transcriptAdjuster.adjust(
      'raw',
      mode({ textModelKey: 'mistral-nemo' }),
      context,
      settings(),
    )

    expect(result).toBe('openrouter adjusted')
    expect(mockGroqComplete).not.toHaveBeenCalled()
    expect(mockOpenRouterComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'mistralai/mistral-nemo',
        apiKey: 'sk-or-test',
        pinnedProvider: undefined,
      }),
    )
  })

  test('forwards the catalogue reasoning setting to both providers', async () => {
    // Sans ce relais, le réglage du catalogue est décoratif : qwen3.7-flash
    // repartirait en thinking par défaut, et gpt-oss en effort medium.
    await transcriptAdjuster.adjust(
      'raw',
      mode({ textModelKey: 'qwen3-flash' }),
      context,
      settings(),
    )
    expect(mockOpenRouterComplete).toHaveBeenCalledWith(
      expect.objectContaining({ reasoningEffort: 'none' }),
    )

    await transcriptAdjuster.adjust(
      'raw',
      mode({ textModelKey: 'gpt-oss-20b-groq' }),
      context,
      settings(),
    )
    expect(mockGroqComplete).toHaveBeenCalledWith(
      expect.objectContaining({ reasoningEffort: 'low' }),
    )
  })

  test('a Cerebras key pins the upstream provider', async () => {
    await transcriptAdjuster.adjust(
      'raw',
      mode({ textModelKey: 'gpt-oss-120b-cerebras' }),
      context,
      settings(),
    )

    expect(mockOpenRouterComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'openai/gpt-oss-120b',
        pinnedProvider: 'cerebras',
      }),
    )
  })

  test('a mode without a model falls back to the global default', async () => {
    await transcriptAdjuster.adjust(
      'raw',
      mode({ textModelKey: null }),
      context,
      settings({ textModelKey: 'gpt-oss-20b-groq' }),
    )

    expect(mockGroqComplete).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'openai/gpt-oss-20b' }),
    )
  })

  test('an unknown key falls back to the default model', async () => {
    await transcriptAdjuster.adjust(
      'raw',
      mode({ textModelKey: 'model-that-left-the-catalogue' }),
      context,
      settings(),
    )

    expect(mockGroqComplete).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'openai/gpt-oss-20b' }),
    )
  })

  test('the mode instructions become the system message', async () => {
    await transcriptAdjuster.adjust(
      'raw',
      mode({ textModelKey: 'gpt-oss-20b-groq' }),
      context,
      settings(),
    )

    const [{ messages }] = mockGroqComplete.mock.calls[0] as any[]
    expect(messages[0].role).toBe('system')
    expect(messages[0].content).toContain('## Role')
    // La langue du mode est imposée à la sortie.
    expect(messages[0].content).toContain('French')
    expect(messages[1]).toEqual({ role: 'user', content: 'raw' })
  })

  test('an automatic language leaves the output language alone', async () => {
    await transcriptAdjuster.adjust(
      'raw',
      mode({ textModelKey: 'gpt-oss-20b-groq', language: 'auto' }),
      context,
      settings(),
    )

    const [{ messages }] = mockGroqComplete.mock.calls[0] as any[]
    expect(messages[0].content).not.toContain('Always write the result in')
  })

  test('a failed adjustment returns the raw transcript', async () => {
    mockOpenRouterComplete.mockRejectedValue(new Error('rate limited'))

    const result = await transcriptAdjuster.adjust(
      'raw transcript',
      mode({ textModelKey: 'mistral-nemo' }),
      context,
      settings(),
    )

    expect(result).toBe('raw transcript')
  })

  test('an empty completion returns the raw transcript', async () => {
    mockGroqComplete.mockResolvedValue('')

    const result = await transcriptAdjuster.adjust(
      'raw transcript',
      mode({ textModelKey: 'gpt-oss-20b-groq' }),
      context,
      settings(),
    )

    expect(result).toBe('raw transcript')
  })
})
