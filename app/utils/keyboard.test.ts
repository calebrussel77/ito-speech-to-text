import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { KeyState, validateShortcutForDuplicate } from './keyboard'
import type { KeyEvent } from '@/lib/preload'
import type { KeyName } from '@/lib/types/keyboard'
import type { KeyboardShortcutConfig } from '@/lib/main/store'

// Mock the window.api for KeyState tests
const mockApi = {
  blockKeys: mock(),
}

global.window = {
  api: mockApi as any,
} as any

beforeEach(() => {
  mockApi.blockKeys.mockClear()
})

describe('KeyState', () => {
  let keyState: KeyState

  beforeEach(() => {
    keyState = new KeyState()
  })

  describe('constructor', () => {
    test('should initialize with no pressed keys', () => {
      const state = new KeyState()
      expect(state.getPressedKeys()).toEqual([])
    })
  })

  describe('update', () => {
    test('should track keydown events', () => {
      keyState.update({ key: 'KeyA', type: 'keydown' } as KeyEvent)
      expect(keyState.getPressedKeys()).toContain('a')
      expect(keyState.isKeyPressed('a')).toBe(true)
    })

    test('should track keyup events', () => {
      keyState.update({ key: 'KeyA', type: 'keydown' } as KeyEvent)
      keyState.update({ key: 'KeyA', type: 'keyup' } as KeyEvent)
      expect(keyState.getPressedKeys()).not.toContain('a')
      expect(keyState.isKeyPressed('a')).toBe(false)
    })

    test('should ignore fn_fast events', () => {
      keyState.update({ key: 'Unknown(179)', type: 'keydown' } as KeyEvent)
      expect(keyState.getPressedKeys()).toEqual([])
    })

    test('should track multiple keys', () => {
      keyState.update({ key: 'KeyA', type: 'keydown' } as KeyEvent)
      keyState.update({ key: 'KeyB', type: 'keydown' } as KeyEvent)
      expect(keyState.getPressedKeys()).toContain('a')
      expect(keyState.getPressedKeys()).toContain('b')
      expect(keyState.getPressedKeys()).toHaveLength(2)
    })
  })

  describe('getPressedKeys', () => {
    test('should return empty array initially', () => {
      expect(keyState.getPressedKeys()).toEqual([])
    })

    test('should return currently pressed keys', () => {
      keyState.update({ key: 'KeyA', type: 'keydown' } as KeyEvent)
      keyState.update({ key: 'Space', type: 'keydown' } as KeyEvent)
      const pressed = keyState.getPressedKeys()
      expect(pressed).toContain('a')
      expect(pressed).toContain('space')
      expect(pressed).toHaveLength(2)
    })
  })

  describe('isKeyPressed', () => {
    test('should return false for unpressed keys', () => {
      expect(keyState.isKeyPressed('a')).toBe(false)
    })

    test('should return true for pressed keys', () => {
      keyState.update({ key: 'KeyA', type: 'keydown' } as KeyEvent)
      expect(keyState.isKeyPressed('a')).toBe(true)
    })
  })

  describe('clear', () => {
    test('should clear all pressed keys', () => {
      keyState.update({ key: 'KeyA', type: 'keydown' } as KeyEvent)
      keyState.update({ key: 'KeyB', type: 'keydown' } as KeyEvent)
      keyState.clear()
      expect(keyState.getPressedKeys()).toEqual([])
      expect(keyState.isKeyPressed('a')).toBe(false)
      expect(keyState.isKeyPressed('b')).toBe(false)
    })

    test('should clear all pressed keys', () => {
      keyState.update({ key: 'KeyA', type: 'keydown' } as KeyEvent)
      keyState.clear()
      expect(keyState.getPressedKeys()).toHaveLength(0)
    })
  })

  describe('key tracking behavior', () => {
    test('should track letter keys correctly', () => {
      keyState.update({ key: 'KeyA', type: 'keydown' } as KeyEvent)
      expect(keyState.getPressedKeys()).toContain('a')
    })

    test('should track multiple keys pressed together', () => {
      keyState.update({ key: 'MetaLeft', type: 'keydown' } as KeyEvent)
      keyState.update({ key: 'KeyZ', type: 'keydown' } as KeyEvent)
      expect(keyState.isKeyPressed('command-left')).toBe(true)
      expect(keyState.isKeyPressed('z')).toBe(true)
    })

    test('should track key releases correctly', () => {
      keyState.update({ key: 'MetaLeft', type: 'keydown' } as KeyEvent)

      keyState.update({ key: 'MetaLeft', type: 'keyup' } as KeyEvent)
      expect(keyState.isKeyPressed('command-left')).toBe(false)
    })

    test('should track multiple modifier keys', () => {
      keyState.update({ key: 'MetaLeft', type: 'keydown' } as KeyEvent)
      keyState.update({ key: 'ShiftLeft', type: 'keydown' } as KeyEvent)

      expect(keyState.isKeyPressed('command-left')).toBe(true)
      expect(keyState.isKeyPressed('shift-left')).toBe(true)
    })

    test('should track fn key presses', () => {
      keyState.update({ key: 'Function', type: 'keydown' } as KeyEvent)

      expect(keyState.isKeyPressed('fn')).toBe(true)
    })

    test('should track command keys correctly', () => {
      keyState.update({ key: 'MetaLeft', type: 'keydown' } as KeyEvent)

      // Should track the command key (as command-left)
      expect(keyState.isKeyPressed('command-left')).toBe(true)
      expect(keyState.getPressedKeys()).toContain('command-left')
    })
  })

  describe('edge cases', () => {
    test('should handle same key pressed multiple times', () => {
      keyState.update({ key: 'KeyA', type: 'keydown' } as KeyEvent)
      keyState.update({ key: 'KeyA', type: 'keydown' } as KeyEvent)
      expect(keyState.getPressedKeys()).toEqual(['a'])
    })

    test('should handle keyup for unpressed key', () => {
      keyState.update({ key: 'KeyA', type: 'keyup' } as KeyEvent)
      expect(keyState.getPressedKeys()).toEqual([])
    })
  })
})

describe('validateShortcutForDuplicate', () => {
  const chord = ['control-left', 'command-left'] as KeyName[]

  const shortcuts: KeyboardShortcutConfig[] = [
    { id: 'dedicated', keys: chord, modeId: 'voice-to-text' },
    { id: 'default', keys: ['option-left'] as KeyName[], modeId: null },
  ]

  test('the shortcut that follows the active mode cannot steal a mode chord', () => {
    // `modeId: null` doit se comparer comme n'importe quel autre mode : sans ça
    // le raccourci par défaut aurait pu prendre une combinaison déjà attribuée,
    // et seul le premier des deux se serait déclenché — en silence.
    const result = validateShortcutForDuplicate(
      shortcuts,
      { id: 'default', keys: chord, modeId: null },
      null,
    )

    expect(result).toEqual({ success: false, error: 'duplicate-key-diff-mode' })
  })

  test('a mode chord free of collisions passes', () => {
    const result = validateShortcutForDuplicate(
      shortcuts,
      { id: 'other', keys: ['space'] as KeyName[], modeId: 'intelligent' },
      'intelligent',
    )

    expect(result).toBeNull()
  })

  test('the duplicate is reported as the same mode when it is', () => {
    const result = validateShortcutForDuplicate(
      shortcuts,
      { id: 'another-row', keys: chord, modeId: 'voice-to-text' },
      'voice-to-text',
    )

    expect(result).toEqual({ success: false, error: 'duplicate-key-same-mode' })
  })
})
