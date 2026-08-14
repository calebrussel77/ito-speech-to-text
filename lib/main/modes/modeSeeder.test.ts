import { describe, test, expect, mock, beforeEach } from 'bun:test'

let applied: string[] = []
const mockStoreGet = mock((key: string) =>
  key === 'appliedMigrations' ? applied : undefined,
)
const mockStoreSet = mock((key: string, value: unknown) => {
  if (key === 'appliedMigrations') applied = value as string[]
})

mock.module('../store', () => ({
  default: { get: mockStoreGet, set: mockStoreSet },
  store: { get: mockStoreGet, set: mockStoreSet },
}))

const existing: any[] = []
const mockFindAll = mock(async (_userId: string) => existing)
const mockInsert = mock(async (mode: any) => mode)

mock.module('./ModeRepository', () => ({
  ModesTable: { findAll: mockFindAll, insert: mockInsert },
}))

const { seedModes } = await import('./modeSeeder')

describe('seedModes', () => {
  beforeEach(() => {
    applied = []
    existing.length = 0
    mockFindAll.mockClear()
    mockInsert.mockClear()
    mockStoreSet.mockClear()
  })

  test('creates the five presets on a fresh install, with readable stable ids', async () => {
    const created = await seedModes('self-hosted')

    expect(created).toBe(5)
    expect(mockInsert.mock.calls.map(c => c[0].id)).toEqual([
      'voice-to-text',
      'intelligent',
      'message',
      'mail',
      'blank',
    ])
  })

  test('Meeting is not seeded here — its engine only exists at lot 3', async () => {
    await seedModes('self-hosted')
    expect(mockInsert.mock.calls.map(c => c[0].id)).not.toContain('meeting')
  })

  test('sort_order follows the preset order', async () => {
    await seedModes('self-hosted')
    expect(mockInsert.mock.calls.map(c => c[0].sortOrder)).toEqual([
      0, 1, 2, 3, 4,
    ])
  })

  test('is idempotent — a second run creates nothing', async () => {
    existing.push(
      ...['voice-to-text', 'intelligent', 'message', 'mail', 'blank'].map(
        id => ({ id }),
      ),
    )

    expect(await seedModes('self-hosted')).toBe(0)
    expect(mockInsert).not.toHaveBeenCalled()
  })

  test('only fills the gaps on a first run', async () => {
    existing.push({ id: 'voice-to-text' }, { id: 'intelligent' })

    const created = await seedModes('self-hosted')

    expect(created).toBe(3)
    expect(mockInsert.mock.calls.map(c => c[0].id)).toEqual([
      'message',
      'mail',
      'blank',
    ])
  })

  test('copies every preset field onto the mode', async () => {
    await seedModes('self-hosted')
    const mail = mockInsert.mock.calls.find(c => c[0].id === 'mail')![0]

    expect(mail.name).toBe('Mail')
    expect(mail.preset).toBe('mail')
    expect(mail.icon).toBe('Envelope')
    expect(mail.useLlm).toBe(true)
    expect(mail.voiceModelKey).toBe('qwen3-asr-flash')
    expect(mail.userId).toBe('self-hosted')
  })

  test('a mode deleted by the user is never re-seeded', async () => {
    // findAll ne voit pas les lignes supprimées : sans drapeau persistant, un
    // mode supprimé reviendrait à chaque lancement.
    await seedModes('self-hosted')
    mockInsert.mockClear()

    existing.push(
      ...['voice-to-text', 'intelligent', 'message', 'blank'].map(id => ({
        id,
      })),
    )

    expect(await seedModes('self-hosted')).toBe(0)
    expect(mockInsert).not.toHaveBeenCalled()
  })

  test('the done flag lands in appliedMigrations, the only list initializeStore reloads', async () => {
    await seedModes('self-hosted')

    expect(mockStoreSet).toHaveBeenCalledWith(
      'appliedMigrations',
      expect.arrayContaining(['2026-08-14-seed-modes']),
    )
  })
})
