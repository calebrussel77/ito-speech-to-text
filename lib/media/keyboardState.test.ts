import { describe, test, expect, afterEach } from 'bun:test'
import {
  pressedKeys,
  areAnyKeysHeld,
  waitForAllKeysReleased,
} from './keyboardState'

afterEach(() => {
  pressedKeys.clear()
})

describe('keyboardState', () => {
  test('areAnyKeysHeld reflects the pressed set', () => {
    expect(areAnyKeysHeld()).toBe(false)
    pressedKeys.add('alt')
    expect(areAnyKeysHeld()).toBe(true)
  })

  test('waitForAllKeysReleased resolves immediately when idle', async () => {
    const idle = await waitForAllKeysReleased(100, 5)
    expect(idle).toBe(true)
  })

  test('waitForAllKeysReleased waits for release', async () => {
    pressedKeys.add('alt')
    setTimeout(() => pressedKeys.clear(), 30)

    const idle = await waitForAllKeysReleased(500, 5)
    expect(idle).toBe(true)
  })

  test('waitForAllKeysReleased times out when a key stays held', async () => {
    pressedKeys.add('alt')
    const idle = await waitForAllKeysReleased(60, 5)
    expect(idle).toBe(false)
  })
})
