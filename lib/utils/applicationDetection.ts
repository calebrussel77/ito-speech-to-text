import { getActiveWindow } from '../media/active-application'

const TERMINAL_APPS = new Set([
  // macOS terminals
  'terminal',
  'iterm2',
  'iterm',
  'alacritty',
  'kitty',
  'hyper',
  'warp',
  'wezterm',
  'tabby',
  'rio',
  'console',
  'xterm',

  // Windows terminals
  'windows terminal',
  'command prompt',
  'powershell',
  'windows powershell',
  'git bash',
  'msys2',
  'cygwin',
  'ubuntu', // WSL Ubuntu
  'debian', // WSL Debian
  'kali', // WSL Kali

  // IDEs with integrated terminals (cross-platform)
  'visual studio code',
  'visual studio code - insiders',
  'code',
  'code - insiders',
  'visual studio',
  'visual studio 2022',
  'visual studio 2019',
  'intellij idea',
  'intellij idea ultimate',
  'intellij idea community edition',
  'webstorm',
  'pycharm',
  'pycharm professional',
  'pycharm community edition',
  'clion',
  'phpstorm',
  'rubymine',
  'goland',
  'datagrip',
  'rider',
  'android studio',
  'neovim',
  'vim',
  'emacs',

  // Linux terminals
  'gnome-terminal',
  'konsole',
  'xfce4-terminal',
  'mate-terminal',
  'lxterminal',
  'terminator',
  'tilix',
  'guake',
  'yakuake',

  // Windows process names (active-window appName may be the executable stem)
  'windowsterminal',
  'wt',
  'conhost',
  'cmd',
  'pwsh',
  'mintty',
  'openconsole',

  // Apps embedding a terminal where synthetic keystrokes are destructive
  'claude',
  'cursor',
  'windsurf',
  'ghostty',
  'wave',
])

// Substring fallback: catches names the exact list misses (e.g. "Windows
// Terminal Preview", "iTerm2 Beta", unknown terminal emulators). Any app whose
// name contains one of these is treated as a terminal.
const TERMINAL_NAME_FRAGMENTS = [
  'terminal',
  'term',
  'console',
  'cmd',
  'shell',
  'bash',
  'claude',
]

const AXApiNotSupportedApps = new Set([
  'visual studio code',
  'visual studio code - insiders',
  'code',
  'code - insiders',
  'visual studio',
  'visual studio 2022',
  'visual studio 2019',
])

export async function canGetContextWithAccessibilityApis(): Promise<boolean> {
  try {
    const window = await getActiveWindow()
    if (!window?.appName) {
      return false // Default to disallowing context if we can't determine
    }
    const lowerAppName = window.appName.toLowerCase()
    return !AXApiNotSupportedApps.has(lowerAppName)
  } catch (error) {
    console.error('Failed to get active window:', error)
    return false // Default to not allowing context on error
  }
}

export function isTerminalApplication(appName: string): boolean {
  const normalized = appName.toLowerCase().replace(/\.exe$/, '').trim()
  if (TERMINAL_APPS.has(normalized)) {
    return true
  }
  return TERMINAL_NAME_FRAGMENTS.some(fragment =>
    normalized.includes(fragment),
  )
}

/**
 * Whether AUTOMATIC keyboard-simulated context reading is allowed at all.
 * Only macOS qualifies: it has an accessibility-API path, and its keyboard
 * fallback has not been observed interrupting foreground apps. On Windows,
 * app-name blocklists have failed twice at protecting terminals from the
 * simulated Ctrl+C (SIGINT), so automatic simulation is disabled entirely —
 * a blocklist cannot guarantee "never".
 */
export function canSimulateContextKeystrokes(
  targetPlatform: NodeJS.Platform = process.platform,
): boolean {
  return targetPlatform === 'darwin'
}

export async function canGetContextFromCurrentApp(): Promise<boolean> {
  try {
    const window = await getActiveWindow()
    if (!window?.appName) {
      return false // Default to disallowing context if we can't determine
    }
    return !isTerminalApplication(window.appName)
  } catch (error) {
    console.error('Failed to get active window:', error)
    return false // Default to not allowing context on error
  }
}
