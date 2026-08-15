import { KeyEvent } from '@/lib/preload'
import { KeyboardShortcutConfig } from '@/lib/main/store'
import {
  keyNameMap,
  normalizeLegacyKey,
  getKeyDisplayInfo,
  KeyName,
} from '@/lib/types/keyboard'

/**
 * Helper to format directional indicators for modifier keys
 */
export function getDirectionalIndicator(
  side: 'left' | 'right' | undefined,
  showText: boolean = false,
): string {
  if (!side) return ''
  const arrow = side === 'left' ? '◀' : '▶'
  if (showText) {
    return side === 'left' ? `${arrow} left` : `right ${arrow}`
  }
  return arrow
}

/**
 * Un accord entier, tel qu'il s'affiche dans un `Kbd` : « Ctrl + ⊞ ».
 *
 * Une seule pastille pour tout l'accord, et pas une par touche : deux pastilles
 * côte à côte ne disaient pas si les touches se pressent ensemble ou l'une
 * après l'autre. Le « + » le dit, et c'est la forme des exemples de shadcn.
 *
 * Les indicateurs de côté sont retirés ici — ils restent dans les éditeurs de
 * raccourci, où l'on choisit une touche physique précise, et le détail complet
 * survit en `title` sur l'élément qui porte l'accord.
 */
export function formatChord(
  keys: KeyName[],
  platform: 'darwin' | 'win32' | undefined,
): string {
  return keys
    .map(key => getKeyDisplay(key, platform, { showDirection: false }))
    .join(' + ')
}

/** Le même accord, côtés compris : « Ctrl ◀ + ⊞ ◀ ». Pour un `title`. */
export function formatChordDetailed(
  keys: KeyName[],
  platform: 'darwin' | 'win32' | undefined,
): string {
  return keys
    .map(key => getKeyDisplay(key, platform, { showDirectionalText: true }))
    .join(' + ')
}

/**
 * Get formatted display components for a key
 * @param keyboardKey The key name to display
 * @param platform The platform to render keys for
 * @param options Display options
 * @returns Object with formatted display components
 */
export function getKeyDisplay(
  keyboardKey: KeyName,
  platform: 'darwin' | 'win32' | undefined = 'darwin',
  options: {
    showDirectionalText?: boolean
    /**
     * Affiche le côté de la touche (« Ctrl ◀ »). Vrai par défaut : les
     * éditeurs de raccourci en ont besoin, puisque `control-left` et
     * `control-right` sont deux touches distinctes pour l'écouteur natif.
     * Les affichages en lecture seule le coupent — dans un accord de deux ou
     * trois touches, les flèches font plus de bruit que d'information.
     */
    showDirection?: boolean
    format?: 'symbol' | 'label' | 'both'
  } = {},
): string {
  const {
    showDirectionalText = false,
    showDirection = true,
    format = 'symbol',
  } = options

  const displayInfo = getKeyDisplayInfo(keyboardKey, platform)
  const dirIndicator = showDirection
    ? getDirectionalIndicator(displayInfo.side, showDirectionalText)
    : ''

  const label = displayInfo.label

  let result: string
  if (displayInfo.isModifier && displayInfo.symbol) {
    if (format === 'symbol') {
      result = displayInfo.symbol
      if (dirIndicator) {
        result = showDirectionalText
          ? `${result} ${dirIndicator}`
          : `${result} ${dirIndicator}`
      }
    } else if (format === 'label') {
      result = label
      if (dirIndicator) {
        result = showDirectionalText
          ? `${result} ${dirIndicator}`
          : `${result} ${dirIndicator}`
      }
    } else {
      // 'both'
      result = `${displayInfo.symbol} ${label}`
      if (dirIndicator) {
        result = `${result} ${dirIndicator}`
      }
    }
  } else {
    result = label
  }

  return result
}

export type ShortcutError =
  | 'duplicate-key-same-mode'
  | 'duplicate-key-diff-mode'
  | 'not-found'
  | 'reserved-combination'

export type ShortcutResult = {
  success: boolean
  error?: ShortcutError
  errorMessage?: string
}

const MODIFIER_SEQUENCE = [
  'control',
  'control-left',
  'control-right',
  'option',
  'option-left',
  'option-right',
  'alt',
  'shift',
  'shift-left',
  'shift-right',
  'command',
  'command-left',
  'command-right',
  'fn',
] as const

const MODIFIER_INDEX: Record<string, number> = MODIFIER_SEQUENCE.reduce(
  (acc, key, i) => {
    acc[key] = i
    return acc
  },
  {} as Record<string, number>,
)

function normalizeKey(raw: KeyName): KeyName {
  return raw.trim().toLowerCase() as KeyName
}

function sortKeysCanonical(keys: KeyName[]): KeyName[] {
  const unique = Array.from(new Set(keys.map(normalizeKey)))

  const modifiers: KeyName[] = []
  const nonModifiers: KeyName[] = []

  for (const key of unique) {
    if (key in MODIFIER_INDEX) modifiers.push(key)
    else nonModifiers.push(key)
  }

  modifiers.sort((a, b) => MODIFIER_INDEX[a] - MODIFIER_INDEX[b])
  nonModifiers.sort() // simple alphabetical for everything else

  return [...modifiers, ...nonModifiers]
}

export function normalizeChord(keys: KeyName[]): KeyName[] {
  return sortKeysCanonical(keys.filter(Boolean))
}

// Helper to generate all variants of a modifier key (base, left, right)
function modifierVariants(modifier: string): string[] {
  return [modifier, `${modifier}-left`, `${modifier}-right`]
}

// Helper to create reserved combinations for all variants of a modifier
function createReservedCombos(
  modifier: string,
  key: string | null,
  reason: string,
) {
  return modifierVariants(modifier).map(mod => ({
    keys: key ? [mod as KeyName, key as KeyName] : [mod as KeyName],
    reason,
  }))
}

// Get platform-specific reserved combinations
function getReservedCombinations(
  platform: 'darwin' | 'win32' = 'darwin',
): { keys: KeyName[]; reason?: string }[] {
  // Common combinations across all platforms
  const common = [
    // Browser tab switching (works the same on all platforms)
    ...createReservedCombos('control', 'tab', 'Browser tab switching'),
  ]

  if (platform === 'darwin') {
    // macOS uses Command key for system operations
    return [
      ...common,
      ...createReservedCombos('command', 'c', 'Reserved for copying'),
      ...createReservedCombos('command', 'v', 'Reserved for pasting'),
      ...createReservedCombos('command', 'q', 'System quit command'),
      ...createReservedCombos('command', 'w', 'Close window'),
      ...createReservedCombos('command', 'tab', 'System app switching'),
    ]
  } else {
    // Windows uses Control for copy/paste, Alt (option) for app switching
    return [
      ...common,
      ...createReservedCombos('control', 'c', 'Reserved for copying'),
      ...createReservedCombos('control', 'v', 'Reserved for pasting'),
      ...createReservedCombos('control', 'w', 'Close tab/window'),
      ...createReservedCombos(
        'option',
        'tab',
        'System app switching (Alt+Tab)',
      ),
    ]
  }
}

// Check if a shortcut contains reserved key combinations
export function isReservedCombination(
  keys: KeyName[],
  platform: 'darwin' | 'win32' = 'darwin',
): {
  isReserved: boolean
  reason?: string
} {
  // Normalize legacy keys to new format
  const normalizedKeys = sortKeysCanonical(keys.map(normalizeLegacyKey))

  // Get platform-specific reserved combinations
  const reservedCombinations = getReservedCombinations(platform)

  for (const reserved of reservedCombinations) {
    const normalizedReserved = sortKeysCanonical(reserved.keys)

    // Check for exact match - same number of keys and all keys match
    const isExactMatch =
      normalizedKeys.length === normalizedReserved.length &&
      normalizedReserved.every(reservedKey => {
        return normalizedKeys.includes(reservedKey)
      })

    if (isExactMatch) {
      return { isReserved: true, reason: reserved.reason }
    }
  }

  return { isReserved: false }
}

// Returns the mode id of the duplicate shortcut if found, otherwise undefined
export function isDuplicateShortcut(
  currentShortcuts: KeyboardShortcutConfig[],
  shortcutToCheck: KeyboardShortcutConfig,
): string | null | undefined {
  // Normalize keys for comparison
  const normalizedCheckKeys = sortKeysCanonical(
    shortcutToCheck.keys.map(normalizeLegacyKey),
  )

  const duplicate = currentShortcuts.find(ks => {
    if (ks.id === shortcutToCheck.id) return false

    const normalizedStoredKeys = sortKeysCanonical(
      ks.keys.map(normalizeLegacyKey),
    )

    // Check if all keys match exactly
    return (
      JSON.stringify(normalizedCheckKeys) ===
      JSON.stringify(normalizedStoredKeys)
    )
  })

  if (duplicate) {
    return duplicate.modeId
  }

  return undefined
}

// Helper to validate duplicate shortcuts and return appropriate error result
export function validateShortcutForDuplicate(
  currentShortcuts: KeyboardShortcutConfig[],
  shortcutToCheck: KeyboardShortcutConfig,
  expectedModeId: string | null,
): ShortcutResult | null {
  const duplicateMode = isDuplicateShortcut(currentShortcuts, shortcutToCheck)

  if (duplicateMode !== undefined) {
    const sameMode = duplicateMode === expectedModeId
    return {
      success: false,
      error: sameMode ? 'duplicate-key-same-mode' : 'duplicate-key-diff-mode',
    }
  }

  return null // No duplicate found, validation passes
}

/**
 * Tracks the state of currently pressed keys
 */
export class KeyState {
  private pressedKeys: Set<KeyName> = new Set()

  /**
   * Updates the key state based on a key event
   * @param event The key event from the global key listener
   */
  update(event: KeyEvent) {
    // Use keyNameMap for proper directional key preservation
    const key = keyNameMap[event.key] || event.key.toLowerCase()

    // Handle Function key special case
    if (key === 'fn_fast') {
      return
    }

    if (event.type === 'keydown') {
      this.pressedKeys.add(key)
    } else if (event.type === 'keyup') {
      this.pressedKeys.delete(key)
    }
  }

  /**
   * Gets the currently pressed keys
   * @returns Array of currently pressed key names
   */
  getPressedKeys(): string[] {
    return Array.from(this.pressedKeys)
  }

  /**
   * Checks if a specific key is currently pressed
   * @param key The normalized key name to check
   * @returns Whether the key is currently pressed
   */
  isKeyPressed(key: KeyName): boolean {
    return this.pressedKeys.has(key)
  }

  /**
   * Clears all pressed keys
   */
  clear() {
    this.pressedKeys.clear()
  }
}
