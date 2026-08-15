import { describe, test, expect, mock, beforeEach } from 'bun:test'

let advanced: any = {}
let applied: string[] = []
const modes: any[] = []

const mockStoreGet = mock((key: string) => {
  if (key === 'advancedSettings') return advanced
  if (key === 'appliedMigrations') return applied
  if (key === 'userProfile') return { id: 'self-hosted' }
  return undefined
})
const mockStoreSet = mock((key: string, value: unknown) => {
  if (key === 'advancedSettings') advanced = value
  if (key === 'appliedMigrations') applied = value as string[]
})

mock.module('../store', () => ({
  default: { get: mockStoreGet, set: mockStoreSet },
  store: { get: mockStoreGet, set: mockStoreSet },
  getCurrentUserId: () => 'self-hosted',
}))

const mockUpdate = mock(async (_id: string, _patch: any) => {})
mock.module('./ModeRepository', () => ({
  ModesTable: {
    findAll: async () => modes,
    update: mockUpdate,
  },
}))

const { migrateSettingsIntoModes } = await import('./modeSettingsMigration')

const patchFor = (id: string) =>
  mockUpdate.mock.calls.find(call => call[0] === id)?.[1]

describe('migrateSettingsIntoModes', () => {
  beforeEach(() => {
    applied = []
    mockUpdate.mockClear()
    modes.length = 0
    modes.push(
      { id: 'voice-to-text', useLlm: false },
      { id: 'intelligent', useLlm: true },
      { id: 'message', useLlm: true },
      { id: 'mail', useLlm: true },
      { id: 'blank', useLlm: true },
    )
    advanced = {
      shortVoiceModelKey: 'whisper-large-v3-turbo',
      longVoiceModelKey: 'qwen3-asr-flash',
      textModelKey: 'gpt-5-6-luna',
      llm: {
        editingPrompt: 'Rewrite as a GitHub issue.',
        asrPrompt: 'Dictée technique.',
        asrLanguage: 'fr',
        transcriptionPrompt: 'dead field',
        llmTemperature: 0.1,
        noSpeechThreshold: 0.6,
      },
    }
  })

  test("Caleb's measured voice models land on the right modes", async () => {
    await migrateSettingsIntoModes()

    expect(patchFor('voice-to-text').voiceModelKey).toBe(
      'whisper-large-v3-turbo',
    )
    expect(patchFor('intelligent').voiceModelKey).toBe('qwen3-asr-flash')
  })

  test('the global editing prompt becomes the Intelligent mode instructions', async () => {
    await migrateSettingsIntoModes()
    expect(patchFor('intelligent').instructions).toBe(
      'Rewrite as a GitHub issue.',
    )
  })

  test('an empty editing prompt leaves the preset instructions alone', async () => {
    advanced.llm.editingPrompt = ''
    await migrateSettingsIntoModes()
    expect(patchFor('intelligent')?.instructions).toBeUndefined()
  })

  test('the ASR priming and language reach every mode', async () => {
    await migrateSettingsIntoModes()
    for (const id of [
      'voice-to-text',
      'intelligent',
      'message',
      'mail',
      'blank',
    ]) {
      expect(patchFor(id).asrPrompt).toBe('Dictée technique.')
      expect(patchFor(id).language).toBe('fr')
    }
  })

  test('an unsupported ASR language falls back to automatic', async () => {
    advanced.llm.asrLanguage = 'de'
    await migrateSettingsIntoModes()
    expect(patchFor('intelligent').language).toBe('auto')
  })

  test('the text model only reaches the modes that use the LLM', async () => {
    await migrateSettingsIntoModes()
    expect(patchFor('intelligent').textModelKey).toBe('gpt-5-6-luna')
    expect(patchFor('voice-to-text').textModelKey).toBeUndefined()
  })

  test('the dead and migrated settings are removed from the store', async () => {
    await migrateSettingsIntoModes()

    expect(advanced.shortVoiceModelKey).toBeUndefined()
    expect(advanced.longVoiceModelKey).toBeUndefined()
    expect(advanced.longDictationEnabled).toBeUndefined()
    expect(advanced.longDictationThresholdMs).toBeUndefined()
    expect(advanced.llm.editingPrompt).toBeUndefined()
    expect(advanced.llm.transcriptionPrompt).toBeUndefined()
    expect(advanced.llm.asrPrompt).toBeUndefined()
    expect(advanced.llm.asrLanguage).toBeUndefined()
    // Conservés : ils restent globaux.
    expect(advanced.llm.noSpeechThreshold).toBe(0.6)
    expect(advanced.textModelKey).toBe('gpt-5-6-luna')
  })

  test('runs once, and the flag lands where initializeStore will actually reload it', async () => {
    await migrateSettingsIntoModes()

    expect(applied).toContain('2026-08-14-settings-into-modes')

    mockUpdate.mockClear()
    await migrateSettingsIntoModes()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  test('a fresh install with no legacy settings touches no mode, only marks the flag', async () => {
    // On a fresh install these four keys never existed — only a pre-modes
    // store carries them. Without the guard this migration would still
    // "run once" here, flattening the presets the seeder just wrote
    // (deliberately different language/model per mode) to the global
    // defaults.
    advanced = { textModelKey: 'gpt-5-6-luna', llm: { noSpeechThreshold: 0.6 } }

    await migrateSettingsIntoModes()

    expect(mockUpdate).not.toHaveBeenCalled()
    expect(applied).toContain('2026-08-14-settings-into-modes')
  })

  test('a second run after a restart never clobbers the modes', async () => {
    // Le scénario que le drapeau existe pour empêcher : au deuxième passage,
    // asrLanguage n'existe plus, donc la migration écraserait language et
    // textModelKey sur tous les modes.
    await migrateSettingsIntoModes()
    const languageAfterFirstRun = patchFor('intelligent').language
    mockUpdate.mockClear()

    await migrateSettingsIntoModes()

    expect(mockUpdate).not.toHaveBeenCalled()
    expect(languageAfterFirstRun).toBe('fr')
  })
})
