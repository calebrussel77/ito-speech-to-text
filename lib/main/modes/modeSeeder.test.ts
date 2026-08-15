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

// `modes.id` is a global PRIMARY KEY, not scoped by user_id — at most one
// row can ever exist for a given preset id, across every user. This mirrors
// that: a flat list of { id, userId }, no per-user partitioning.
type Row = { id: string; userId: string }
let rows: Row[] = []

const mockFindAllIdsIncludingDeleted = mock(async (userId: string) =>
  rows.filter(r => r.userId === userId).map(r => r.id),
)
const mockFindOwner = mock(
  async (id: string) => rows.find(r => r.id === id)?.userId,
)
const mockReassignOwner = mock(async (id: string, userId: string) => {
  const row = rows.find(r => r.id === id)
  if (row) row.userId = userId
})
const mockInsert = mock(async (mode: any) => {
  rows.push({ id: mode.id, userId: mode.userId })
  return mode
})

mock.module('./ModeRepository', () => ({
  ModesTable: {
    findAllIdsIncludingDeleted: mockFindAllIdsIncludingDeleted,
    findOwner: mockFindOwner,
    reassignOwner: mockReassignOwner,
    insert: mockInsert,
  },
}))

const { seedModes, seedMeetingMode } = await import('./modeSeeder')

describe('seedModes', () => {
  beforeEach(() => {
    applied = []
    rows = []
    mockFindAllIdsIncludingDeleted.mockClear()
    mockFindOwner.mockClear()
    mockReassignOwner.mockClear()
    mockInsert.mockClear()
    mockStoreSet.mockClear()
  })

  test('creates the six presets on a fresh install, with readable stable ids', async () => {
    const created = await seedModes('self-hosted')

    expect(created).toBe(6)
    expect(mockInsert.mock.calls.map(c => c[0].id)).toEqual([
      'voice-to-text',
      'intelligent',
      'meeting',
      'message',
      'mail',
      'blank',
    ])
  })

  test('Meeting is seeded here too, now that its Deepgram engine exists', async () => {
    await seedModes('self-hosted')
    expect(mockInsert.mock.calls.map(c => c[0].id)).toContain('meeting')
  })

  test('sort_order follows the preset order', async () => {
    await seedModes('self-hosted')
    expect(mockInsert.mock.calls.map(c => c[0].sortOrder)).toEqual([
      0, 1, 2, 3, 4, 5,
    ])
  })

  test('is idempotent — a second run creates nothing', async () => {
    await seedModes('self-hosted')
    mockInsert.mockClear()

    expect(await seedModes('self-hosted')).toBe(0)
    expect(mockInsert).not.toHaveBeenCalled()
  })

  test('only fills the gaps on a first run', async () => {
    rows.push(
      { id: 'voice-to-text', userId: 'self-hosted' },
      { id: 'intelligent', userId: 'self-hosted' },
    )

    const created = await seedModes('self-hosted')

    expect(created).toBe(4)
    expect(mockInsert.mock.calls.map(c => c[0].id)).toEqual([
      'meeting',
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
    // findAllIdsIncludingDeleted (unlike the old, deleted_at-filtering
    // findAll) sees a soft-deleted row too — from the seeder's point of
    // view a deleted 'mail' and a live one are the same: both mean "don't
    // insert".
    mockFindAllIdsIncludingDeleted.mockImplementationOnce(async () => [
      'voice-to-text',
      'intelligent',
      'meeting',
      'message',
      'mail',
      'blank',
    ])

    const created = await seedModes('self-hosted')

    expect(created).toBe(0)
    expect(mockInsert).not.toHaveBeenCalled()
  })

  test('re-homes a preset already seeded under a different user instead of inserting a duplicate', async () => {
    // self-hosted already owns 'voice-to-text' from before a user signed
    // in. modes.id being a global PRIMARY KEY means inserting it again
    // under 'user-a' would be a key collision, not a new row.
    rows.push({ id: 'voice-to-text', userId: 'self-hosted' })

    const created = await seedModes('user-a')

    expect(mockReassignOwner).toHaveBeenCalledWith('voice-to-text', 'user-a')
    expect(mockInsert.mock.calls.map(c => c[0].id)).not.toContain(
      'voice-to-text',
    )
    expect(mockInsert.mock.calls.map(c => c[0].id)).toEqual([
      'intelligent',
      'meeting',
      'message',
      'mail',
      'blank',
    ])
    expect(created).toBe(5)
  })

  test('bridges the legacy global flag so an existing single-user install is not re-seeded', async () => {
    // Installs from before the flag was keyed per user set the bare
    // SEED_ID flag. Without the bridge, every one of them looks unseeded
    // on next launch — harmless if every preset survives, a collision (or
    // worse, a resurrected preset) the moment the user deleted one.
    applied = ['2026-08-14-seed-modes']

    const created = await seedModes('self-hosted')

    expect(created).toBe(0)
    expect(mockInsert).not.toHaveBeenCalled()
    expect(mockFindAllIdsIncludingDeleted).not.toHaveBeenCalled()
    expect(applied).toEqual(
      expect.arrayContaining(['2026-08-14-seed-modes:self-hosted']),
    )
  })

  test('never throws — a seeding failure must not be able to take down startup', async () => {
    mockFindAllIdsIncludingDeleted.mockImplementationOnce(async () => {
      throw new Error('SQLite is on fire')
    })

    await expect(seedModes('self-hosted')).resolves.toBe(0)
  })

  test('the done flag lands in appliedMigrations, the only list initializeStore reloads', async () => {
    await seedModes('self-hosted')

    expect(mockStoreSet).toHaveBeenCalledWith(
      'appliedMigrations',
      expect.arrayContaining(['2026-08-14-seed-modes:self-hosted']),
    )
  })

  test('the seed flag is keyed per user, so signing in as someone new re-homes the existing presets instead of refusing to run', async () => {
    // Modes are scoped by user_id, but a global flag would see the new
    // user as "already seeded" and refuse to run, leaving them with zero
    // modes.
    await seedModes('user-a')
    mockInsert.mockClear()
    mockReassignOwner.mockClear()

    const createdForB = await seedModes('user-b')

    // Real installs share one global id space (modes.id is a PRIMARY KEY),
    // so user-b can't get an independent duplicate 'voice-to-text' row —
    // they get user-a's, re-homed.
    expect(createdForB).toBe(0)
    expect(mockInsert).not.toHaveBeenCalled()
    expect(mockReassignOwner).toHaveBeenCalledTimes(6)
    expect(rows.every(r => r.userId === 'user-b')).toBe(true)
    expect(applied).toEqual(
      expect.arrayContaining([
        '2026-08-14-seed-modes:user-a',
        '2026-08-14-seed-modes:user-b',
      ]),
    )
  })

  test('re-seeding the same user a second time still creates nothing', async () => {
    await seedModes('user-a')
    mockInsert.mockClear()

    expect(await seedModes('user-a')).toBe(0)
    expect(mockInsert).not.toHaveBeenCalled()
  })
})

describe('seedMeetingMode', () => {
  beforeEach(() => {
    applied = []
    rows = []
    mockFindAllIdsIncludingDeleted.mockClear()
    mockFindOwner.mockClear()
    mockReassignOwner.mockClear()
    mockInsert.mockClear()
    mockStoreSet.mockClear()
  })

  // `meeting` is now part of `SEEDED_PRESET_KEYS`, so a fresh install gets
  // it straight from `seedModes`. This backfill exists for installs that
  // consumed the main seed flag before Meeting joined the set — they never
  // run that loop again, so without a flag of its own they'd never get it.
  test('an install that already ran the first seed still gets Meeting', async () => {
    applied = ['2026-08-14-seed-modes:self-hosted']
    rows.push(
      ...['voice-to-text', 'intelligent', 'message', 'mail', 'blank'].map(
        id => ({ id, userId: 'self-hosted' }),
      ),
    )

    expect(await seedMeetingMode('self-hosted')).toBe(1)
    expect(mockInsert.mock.calls[0][0].id).toBe('meeting')
  })

  test('it does not come back after the user deletes it', async () => {
    applied = [
      '2026-08-14-seed-modes:self-hosted',
      '2026-08-14-seed-meeting:self-hosted',
    ]

    expect(await seedMeetingMode('self-hosted')).toBe(0)
    expect(mockInsert).not.toHaveBeenCalled()
  })

  test('sees a soft-deleted Meeting row and does not resurrect it', async () => {
    // Same guarantee as `seedModes`: existence is judged via
    // `findAllIdsIncludingDeleted`, which sees a soft-deleted row too.
    mockFindAllIdsIncludingDeleted.mockImplementationOnce(async () => [
      'meeting',
    ])

    expect(await seedMeetingMode('self-hosted')).toBe(0)
    expect(mockInsert).not.toHaveBeenCalled()
  })

  test('re-homes Meeting seeded under a different user instead of inserting a duplicate', async () => {
    rows.push({ id: 'meeting', userId: 'self-hosted' })

    const created = await seedMeetingMode('user-a')

    expect(mockReassignOwner).toHaveBeenCalledWith('meeting', 'user-a')
    expect(mockInsert).not.toHaveBeenCalled()
    expect(created).toBe(0)
  })

  test('is idempotent — a second run creates nothing', async () => {
    await seedMeetingMode('self-hosted')
    mockInsert.mockClear()

    expect(await seedMeetingMode('self-hosted')).toBe(0)
    expect(mockInsert).not.toHaveBeenCalled()
  })

  test('the seed flag is keyed per user, like seedModes', async () => {
    await seedMeetingMode('self-hosted')

    expect(mockStoreSet).toHaveBeenCalledWith(
      'appliedMigrations',
      expect.arrayContaining(['2026-08-14-seed-meeting:self-hosted']),
    )
  })

  test('never throws — a seeding failure must not be able to take down startup', async () => {
    mockFindAllIdsIncludingDeleted.mockImplementationOnce(async () => {
      throw new Error('SQLite is on fire')
    })

    await expect(seedMeetingMode('self-hosted')).resolves.toBe(0)
  })
})
