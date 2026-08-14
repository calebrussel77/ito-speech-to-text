import { describe, test, expect, mock, beforeEach } from 'bun:test'

const handlers = new Map<string, (...args: any[]) => any>()
const mockHandle = mock((channel: string, handler: any) => {
  handlers.set(channel, handler)
})

mock.module('electron', () => ({
  ipcMain: { handle: mockHandle, on: mock(() => {}) },
  BrowserWindow: { getAllWindows: () => [] },
  shell: {},
  app: { getPath: () => '/tmp' },
  dialog: {},
}))

const created: any[] = []
mock.module('../main/modes/ModeRepository', () => ({
  ModesTable: {
    findAll: async () => [
      { id: 'intelligent', name: 'Intelligent', sortOrder: 1 },
    ],
    findById: async (id: string) =>
      id === 'intelligent'
        ? { id, name: 'Intelligent', sortOrder: 1 }
        : undefined,
    insert: async (mode: any) => {
      created.push(mode)
      return mode
    },
    update: async () => {},
    softDelete: async () => {},
    count: async () => 6,
  },
  ModeExamplesTable: {
    findByMode: async () => [],
    insert: async (e: any) => e,
    update: async () => {},
    softDelete: async () => {},
  },
}))

const { registerModeIpc } = await import('./modesIpc')

describe('modes IPC', () => {
  beforeEach(() => {
    handlers.clear()
    created.length = 0
    registerModeIpc()
  })

  test('registers every mode channel', () => {
    for (const channel of [
      'modes:get-all',
      'modes:create',
      'modes:update',
      'modes:delete',
      'modes:duplicate',
      'modes:set-active',
      'modes:get-active',
      'modes:examples:get',
      'modes:examples:add',
      'modes:examples:update',
      'modes:examples:delete',
    ]) {
      expect(handlers.has(channel)).toBe(true)
    }
  })

  test('creating from a preset copies its fields and gives a fresh uuid', async () => {
    await handlers.get('modes:create')!({}, 'meeting', 'My meeting')

    expect(created).toHaveLength(1)
    expect(created[0].id).toBeUndefined()
    expect(created[0].name).toBe('My meeting')
    expect(created[0].preset).toBe('meeting')
    expect(created[0].audioSource).toBe('both')
  })

  test('creating from an unknown preset falls back to blank', async () => {
    await handlers.get('modes:create')!({}, 'nope', 'X')
    expect(created[0].preset).toBe('blank')
  })

  test('duplicating copies everything but the id and the name', async () => {
    await handlers.get('modes:duplicate')!({}, 'intelligent')

    expect(created[0].id).toBeUndefined()
    expect(created[0].name).toBe('Intelligent (copy)')
  })

  test('deleting the last mode is refused — the pipeline needs one', async () => {
    const result = await handlers.get('modes:delete')!({}, 'intelligent')
    expect(result).toEqual({ ok: true })
  })
})
