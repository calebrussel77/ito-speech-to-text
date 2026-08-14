import { describe, test, expect, mock, beforeEach } from 'bun:test'

let settings: any = {}
const modes: any[] = []

mock.module('../store', () => ({
  default: {
    get: (key: string) => (key === 'settings' ? settings : undefined),
    set: (key: string, value: unknown) => {
      if (key === 'settings') settings = value
    },
  },
  store: {
    get: (key: string) => (key === 'settings' ? settings : undefined),
    set: (key: string, value: unknown) => {
      if (key === 'settings') settings = value
    },
  },
  getCurrentUserId: () => 'self-hosted',
}))

mock.module('./ModeRepository', () => ({
  ModesTable: {
    findAll: async () => modes,
    findById: async (id: string) => modes.find(m => m.id === id),
  },
}))

const {
  getActiveModeId,
  setActiveModeId,
  resolveActiveMode,
  resolveMode,
  cycleActiveMode,
} = await import('./activeMode')

describe('activeMode', () => {
  beforeEach(() => {
    settings = {}
    modes.length = 0
    modes.push(
      { id: 'voice-to-text', name: 'Voice to text', sortOrder: 0 },
      { id: 'intelligent', name: 'Intelligent', sortOrder: 1 },
      { id: 'meeting', name: 'Meeting', sortOrder: 2 },
    )
  })

  test('with nothing stored, the first mode is active', async () => {
    expect(getActiveModeId()).toBeUndefined()
    expect((await resolveActiveMode()).id).toBe('voice-to-text')
  })

  test('the active mode round-trips through the store', async () => {
    setActiveModeId('meeting')
    expect(getActiveModeId()).toBe('meeting')
    expect((await resolveActiveMode()).id).toBe('meeting')
  })

  test('a stored id that no longer exists falls back to the first mode', async () => {
    setActiveModeId('deleted-mode')
    expect((await resolveActiveMode()).id).toBe('voice-to-text')
  })

  test('resolveMode falls back rather than returning undefined — a dictation must never be lost to a missing mode', async () => {
    expect((await resolveMode('meeting')).id).toBe('meeting')
    expect((await resolveMode('nope')).id).toBe('voice-to-text')
    expect((await resolveMode(undefined)).id).toBe('voice-to-text')
  })

  test('cycling walks the list and wraps around', async () => {
    setActiveModeId('voice-to-text')

    expect((await cycleActiveMode()).id).toBe('intelligent')
    expect((await cycleActiveMode()).id).toBe('meeting')
    expect((await cycleActiveMode()).id).toBe('voice-to-text')
  })

  test('cycling backwards wraps the other way', async () => {
    setActiveModeId('voice-to-text')
    expect((await cycleActiveMode(-1)).id).toBe('meeting')
  })

  test('cycling with a single mode is a no-op, not a crash', async () => {
    modes.length = 1
    setActiveModeId('voice-to-text')
    expect((await cycleActiveMode()).id).toBe('voice-to-text')
  })
})
