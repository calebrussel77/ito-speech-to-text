/**
 * Physically-held keys, fed by the global key listener. Lives in its own
 * module (not keyboard.ts) so consumers like ContextGrabber can read it
 * without creating an import cycle through itoSessionManager.
 */
export const pressedKeys = new Set<string>()

export function areAnyKeysHeld(): boolean {
  return pressedKeys.size > 0
}

/**
 * Resolves once every physical key is released, or after timeoutMs.
 * Returns true when the keyboard is idle.
 *
 * Ito must never synthesize keystrokes while the user still holds the
 * push-to-talk keys: a simulated Ctrl+C with Alt physically held reaches the
 * focused app as Ctrl+Alt+C, which types "©".
 */
export async function waitForAllKeysReleased(
  timeoutMs = 1500,
  pollMs = 25,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (areAnyKeysHeld()) {
    if (Date.now() > deadline) return false
    await new Promise(resolve => setTimeout(resolve, pollMs))
  }
  return true
}
