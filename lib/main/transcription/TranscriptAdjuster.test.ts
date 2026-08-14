import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { ItoMode } from '@/app/generated/ito_pb'

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
  vocabularyWords: [],
  dictionaryEntries: [],
} as any

const settings = (overrides: Record<string, unknown> = {}) =>
  ({
    llm: { llmTemperature: 0.1, editingPrompt: 'Fix it.' },
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
  test('TRANSCRIBE mode never calls a model', async () => {
    const result = await transcriptAdjuster.adjust(
      '  raw transcript  ',
      ItoMode.TRANSCRIBE,
      context,
      settings({ textModelKey: 'gpt-oss-20b-groq' }),
    )

    expect(result).toBe('raw transcript')
    expect(mockGroqComplete).not.toHaveBeenCalled()
    expect(mockOpenRouterComplete).not.toHaveBeenCalled()
  })

  test('a Groq catalogue key routes to Groq', async () => {
    const result = await transcriptAdjuster.adjust(
      'raw',
      ItoMode.EDIT,
      context,
      settings({ textModelKey: 'gpt-oss-20b-groq' }),
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
      ItoMode.EDIT,
      context,
      settings({ textModelKey: 'mistral-nemo' }),
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

  test('a Cerebras key pins the upstream provider', async () => {
    await transcriptAdjuster.adjust(
      'raw',
      ItoMode.EDIT,
      context,
      settings({ textModelKey: 'gpt-oss-120b-cerebras' }),
    )

    expect(mockOpenRouterComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'openai/gpt-oss-120b',
        pinnedProvider: 'cerebras',
      }),
    )
  })

  test('an unknown key falls back to the default model', async () => {
    await transcriptAdjuster.adjust(
      'raw',
      ItoMode.EDIT,
      context,
      settings({ textModelKey: 'model-that-left-the-catalogue' }),
    )

    expect(mockGroqComplete).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'openai/gpt-oss-20b' }),
    )
  })

  test('a failed adjustment returns the raw transcript', async () => {
    mockOpenRouterComplete.mockRejectedValue(new Error('rate limited'))

    const result = await transcriptAdjuster.adjust(
      'raw transcript',
      ItoMode.EDIT,
      context,
      settings({ textModelKey: 'mistral-nemo' }),
    )

    expect(result).toBe('raw transcript')
  })

  test('an empty completion returns the raw transcript', async () => {
    mockGroqComplete.mockResolvedValue('')

    const result = await transcriptAdjuster.adjust(
      'raw transcript',
      ItoMode.EDIT,
      context,
      settings({ textModelKey: 'gpt-oss-20b-groq' }),
    )

    expect(result).toBe('raw transcript')
  })
})
