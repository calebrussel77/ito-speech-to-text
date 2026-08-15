import { describe, test, expect, mock, beforeEach } from 'bun:test'

const rows: any[] = []
const mockRun = mock(async (_q: string, _p: any[]) => {})
const mockAll = mock(async (_q: string, _p: any[]) => rows)
const mockGet = mock(async (_q: string, _p: any[]) => rows[0])

mock.module('../sqlite/utils', () => ({
  run: mockRun,
  all: mockAll,
  get: mockGet,
}))

const { ModesTable, ModeExamplesTable } = await import('./ModeRepository')

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'intelligent',
  user_id: 'self-hosted',
  name: 'Intelligent',
  preset: 'intelligent',
  icon: 'Sparkles',
  instructions: '## Role\n…',
  language: 'fr',
  voice_model_key: 'qwen3-asr-flash',
  text_model_key: 'gpt-5-6-luna',
  use_llm: 1,
  context_application: 1,
  context_clipboard: 0,
  context_selection: 0,
  audio_source: 'microphone',
  playback_when_recording: 'mute',
  auto_paste: 1,
  autocapitalize: 1,
  identify_speakers: 0,
  asr_prompt: 'Dictée technique…',
  sort_order: 1,
  created_at: '2026-08-14T00:00:00.000Z',
  updated_at: '2026-08-14T00:00:00.000Z',
  deleted_at: null,
  ...overrides,
})

describe('ModesTable', () => {
  beforeEach(() => {
    rows.length = 0
    mockRun.mockClear()
    mockAll.mockClear()
    mockGet.mockClear()
  })

  test('turns SQLite integers into booleans', async () => {
    rows.push(row({ use_llm: 1, context_clipboard: 0, identify_speakers: 1 }))
    const [mode] = await ModesTable.findAll('self-hosted')

    expect(mode.useLlm).toBe(true)
    expect(mode.contextClipboard).toBe(false)
    expect(mode.identifySpeakers).toBe(true)
    expect(mode.voiceModelKey).toBe('qwen3-asr-flash')
  })

  test('excludes soft-deleted modes and orders them', async () => {
    await ModesTable.findAll('self-hosted')
    const [query] = mockAll.mock.calls[0]
    expect(query).toContain('deleted_at IS NULL')
    expect(query).toContain('ORDER BY sort_order ASC, created_at ASC')
  })

  test('insert keeps a caller-supplied id — seeded modes need stable ids', async () => {
    const mode = await ModesTable.insert({
      id: 'meeting',
      userId: 'self-hosted',
      name: 'Meeting',
      preset: 'meeting',
      icon: 'UsersGroup',
      instructions: '',
      language: 'fr',
      voiceModelKey: 'nova-3',
      textModelKey: null,
      useLlm: true,
      contextApplication: false,
      contextClipboard: false,
      contextSelection: false,
      audioSource: 'both',
      playbackWhenRecording: 'leave',
      autoPaste: false,
      autocapitalize: false,
      identifySpeakers: true,
      asrPrompt: '',
      sortOrder: 2,
    })

    expect(mode.id).toBe('meeting')
    const [, params] = mockRun.mock.calls[0]
    // Booleans must reach SQLite as integers, never as `true`.
    expect(params).toContain(1)
    expect(params.some((p: any) => p === true)).toBe(false)
  })

  test('insert generates a uuid when none is given', async () => {
    const mode = await ModesTable.insert({
      userId: 'self-hosted',
      name: 'My mode',
      preset: 'custom',
      icon: 'SquareDashed',
      instructions: '',
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
      sortOrder: 6,
    } as any)

    expect(mode.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  test('update writes only the fields given', async () => {
    await ModesTable.update('intelligent', { name: 'Smart', useLlm: false })
    const [query, params] = mockRun.mock.calls[0]

    expect(query).toContain('name = ?')
    expect(query).toContain('use_llm = ?')
    expect(query).not.toContain('icon = ?')
    expect(params[0]).toBe('Smart')
    expect(params[1]).toBe(0)
  })

  test('update with an empty patch does not hit the database', async () => {
    await ModesTable.update('intelligent', {})
    expect(mockRun).not.toHaveBeenCalled()
  })

  test('softDelete never removes the row', async () => {
    await ModesTable.softDelete('intelligent')
    const [query] = mockRun.mock.calls[0]
    expect(query).toContain('UPDATE modes SET deleted_at')
    expect(query).not.toContain('DELETE FROM')
  })

  test('softDelete also soft-deletes the mode examples — ON DELETE CASCADE never fires on an UPDATE', async () => {
    await ModesTable.softDelete('intelligent')

    expect(mockRun).toHaveBeenCalledTimes(2)
    const [examplesQuery, examplesParams] = mockRun.mock.calls[1]
    expect(examplesQuery).toContain('UPDATE mode_examples SET deleted_at')
    expect(examplesQuery).not.toContain('DELETE FROM')
    expect(examplesParams).toContain('intelligent')
  })

  test('findAllIdsIncludingDeleted does not filter deleted_at — the seeder needs to see soft-deleted presets too', async () => {
    rows.push(
      row({ id: 'mail', deleted_at: '2026-08-14T12:00:00.000Z' }),
      row({ id: 'blank', deleted_at: null }),
    )

    const ids = await ModesTable.findAllIdsIncludingDeleted('self-hosted')
    const [query] = mockAll.mock.calls[0]

    expect(query).not.toContain('deleted_at')
    expect(ids).toEqual(['mail', 'blank'])
  })

  test('findOwner reports the user_id of a row regardless of user or deletion status', async () => {
    rows.push(row({ id: 'mail', user_id: 'user-a' }))

    const owner = await ModesTable.findOwner('mail')
    const [query] = mockGet.mock.calls[0]

    expect(owner).toBe('user-a')
    expect(query).not.toContain('user_id = ?')
    expect(query).not.toContain('deleted_at')
  })

  test('findOwner returns undefined when the id does not exist', async () => {
    const owner = await ModesTable.findOwner('nope')
    expect(owner).toBeUndefined()
  })

  test('reassignOwner updates only user_id (and updated_at), scoped by id', async () => {
    await ModesTable.reassignOwner('voice-to-text', 'user-b')
    const [query, params] = mockRun.mock.calls[0]

    expect(query).toContain('UPDATE modes SET user_id = ?')
    expect(query).toContain('WHERE id = ?')
    expect(params).toEqual(['user-b', expect.any(String), 'voice-to-text'])
  })
})

describe('ModeExamplesTable', () => {
  beforeEach(() => {
    rows.length = 0
    mockRun.mockClear()
    mockAll.mockClear()
  })

  test('returns a mode examples in insertion order', async () => {
    rows.push({
      id: 'e1',
      mode_id: 'intelligent',
      spoken_input: 'buy milk eggs no not eggs cheese',
      ai_output: '- Milk\n- Cheese',
      sort_order: 0,
      created_at: '2026-08-14T00:00:00.000Z',
      updated_at: '2026-08-14T00:00:00.000Z',
      deleted_at: null,
    })

    const [example] = await ModeExamplesTable.findByMode('intelligent')
    expect(example.spokenInput).toBe('buy milk eggs no not eggs cheese')
    expect(example.aiOutput).toBe('- Milk\n- Cheese')

    const [query] = mockAll.mock.calls[0]
    expect(query).toContain('ORDER BY sort_order ASC')
  })
})
