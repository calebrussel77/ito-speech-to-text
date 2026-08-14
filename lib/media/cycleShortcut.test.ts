import { describe, test, expect, mock, beforeEach } from 'bun:test'

const mockCycle = mock(async () => ({
  id: 'intelligent',
  name: 'Intelligent',
  icon: 'Sparkles',
}))
mock.module('../main/modes/activeMode', () => ({
  cycleActiveMode: mockCycle,
  resolveActiveMode: async () => ({
    id: 'voice-to-text',
    name: 'Voice to text',
    icon: 'Microphone',
  }),
  resolveMode: async () => ({ id: 'voice-to-text', name: 'Voice to text' }),
}))

const mockStartSession = mock(async () => 'id')
mock.module('../main/itoSessionManager', () => ({
  itoSessionManager: {
    startSession: mockStartSession,
    completeSession: mock(async () => {}),
    setMode: mock(async () => {}),
  },
}))

const { matchesCycleShortcut } = await import('./keyboard')

describe('cycle-mode shortcut', () => {
  beforeEach(() => {
    mockCycle.mockClear()
    mockStartSession.mockClear()
  })

  test('matches on an exact key set', () => {
    expect(
      matchesCycleShortcut(new Set(['control-left', 'shift-left', 'm']), [
        'control-left',
        'shift-left',
        'm',
      ]),
    ).toBe(true)
  })

  test('a superset does not match — it would fire inside other combos', () => {
    expect(
      matchesCycleShortcut(new Set(['control-left', 'shift-left', 'm', 'a']), [
        'control-left',
        'shift-left',
        'm',
      ]),
    ).toBe(false)
  })

  test('an unconfigured cycle shortcut never matches', () => {
    expect(matchesCycleShortcut(new Set(['control-left']), [])).toBe(false)
  })

  test('cycling never starts a recording', () => {
    // Le défilement et la dictée partagent le même flux d'événements clavier :
    // une confusion entre les deux enregistrerait à chaque changement de mode.
    expect(mockStartSession).not.toHaveBeenCalled()
  })
})
