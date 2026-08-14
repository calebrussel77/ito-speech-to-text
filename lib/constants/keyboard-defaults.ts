// Platform-specific keyboard shortcut defaults, indexed by mode id.
//
// Les modes semés portent un id lisible et stable (`voice-to-text`,
// `intelligent`) : les défauts peuvent donc les nommer directement, sans
// passer par un enum que plus rien ne porte.
const MAC_DEFAULTS: Record<string, string[]> = {
  'voice-to-text': ['fn'],
  intelligent: ['control-left', 'fn'],
}

const WIN_DEFAULTS: Record<string, string[]> = {
  'voice-to-text': ['control-left', 'command-left'],
  intelligent: ['option-left', 'control-left'],
}

// Helper to detect platform - works in both main and renderer process
export function getPlatform(): 'darwin' | 'win32' {
  if (typeof process !== 'undefined' && process.platform) {
    return process.platform as 'darwin' | 'win32'
  }
  // Fallback if process is not available
  return 'darwin'
}

// Get platform-specific defaults
export function getModeShortcutDefaults(
  platform?: 'darwin' | 'win32',
): Record<string, string[]> {
  const currentPlatform = platform || getPlatform()
  return currentPlatform === 'darwin' ? MAC_DEFAULTS : WIN_DEFAULTS
}

// For backward compatibility, export the defaults for the current platform
export const MODE_SHORTCUT_DEFAULTS = getModeShortcutDefaults()
