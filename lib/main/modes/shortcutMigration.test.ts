import { describe, test, expect, mock, beforeEach } from 'bun:test'

let settings: any = {}
let applied: string[] = []

const mockStoreGet = mock((key: string) => {
  if (key === 'settings') return settings
  if (key === 'appliedMigrations') return applied
  return undefined
})
const mockStoreSet = mock((key: string, value: unknown) => {
  if (key === 'settings') settings = value
  if (key === 'appliedMigrations') applied = value as string[]
})

mock.module('../store', () => ({
  default: { get: mockStoreGet, set: mockStoreSet },
  store: { get: mockStoreGet, set: mockStoreSet },
}))

const { migrateShortcutsToModeIds } = await import('./shortcutMigration')

describe('migrateShortcutsToModeIds', () => {
  beforeEach(() => {
    applied = []
    mockStoreSet.mockClear()
    // Le JSON exact du store de Caleb au 2026-08-14.
    settings = {
      keyboardShortcuts: [
        {
          id: 'ed826a4b-532c-49d5-bb3b-c076ba6ffc69',
          keys: ['control-left', 'command-left'],
          mode: 0,
        },
        {
          id: '66da8422-884e-4549-9d45-a0d0b7a0909a',
          keys: ['option-left', 'control-left'],
          mode: 1,
        },
      ],
    }
  })

  test('maps the two legacy modes onto the seeded mode ids', () => {
    migrateShortcutsToModeIds()

    expect(settings.keyboardShortcuts).toEqual([
      {
        id: 'ed826a4b-532c-49d5-bb3b-c076ba6ffc69',
        keys: ['control-left', 'command-left'],
        modeId: 'voice-to-text',
      },
      {
        id: '66da8422-884e-4549-9d45-a0d0b7a0909a',
        keys: ['option-left', 'control-left'],
        modeId: 'intelligent',
      },
    ])
  })

  test('keys and shortcut ids survive untouched — this is the highest-risk migration', () => {
    const before = JSON.parse(JSON.stringify(settings.keyboardShortcuts))
    migrateShortcutsToModeIds()

    settings.keyboardShortcuts.forEach((shortcut: any, index: number) => {
      expect(shortcut.id).toBe(before[index].id)
      expect(shortcut.keys).toEqual(before[index].keys)
    })
  })

  test('an unknown legacy mode falls back to voice-to-text rather than losing the binding', () => {
    settings.keyboardShortcuts = [{ id: 'x', keys: ['fn'], mode: 7 }]
    migrateShortcutsToModeIds()
    expect(settings.keyboardShortcuts[0].modeId).toBe('voice-to-text')
  })

  test('runs once', () => {
    migrateShortcutsToModeIds()
    mockStoreSet.mockClear()
    migrateShortcutsToModeIds()
    expect(mockStoreSet).not.toHaveBeenCalled()
  })

  test('a store with no shortcuts does not throw', () => {
    settings = {}
    expect(() => migrateShortcutsToModeIds()).not.toThrow()
  })
})
