import { create } from 'zustand'
import {
  analytics,
  ANALYTICS_EVENTS,
  updateAnalyticsFromSettings,
} from '@/app/components/analytics'
import { STORE_KEYS } from '../../lib/constants/store-keys'
import type {
  InteractionSoundTheme,
  KeyboardShortcutConfig,
} from '@/lib/main/store'
import {
  ACTIVE_MODE_SHORTCUT_ID,
  MODE_SHORTCUT_DEFAULTS,
} from '@/lib/constants/keyboard-defaults'
import {
  normalizeChord,
  ShortcutResult,
  validateShortcutForDuplicate,
  isReservedCombination,
} from '../utils/keyboard'
import { KeyName } from '@/lib/types/keyboard'
import { IPC_EVENTS } from '@/lib/types/ipc'

interface SettingsState {
  shareAnalytics: boolean
  launchAtLogin: boolean
  showItoBarAlways: boolean
  showAppInDock: boolean
  runInBackground: boolean
  interactionSounds: boolean
  interactionSoundTheme: InteractionSoundTheme
  muteAudioWhenDictating: boolean
  pasteCombo: 'auto' | 'ctrl-v' | 'ctrl-shift-v' | 'shift-insert'
  microphoneDeviceId: string
  microphoneName: string
  theme: 'light' | 'dark' | 'system'
  keyboardShortcuts: KeyboardShortcutConfig[]
  /** Fait défiler le mode actif sans ouvrir la fenêtre principale. */
  cycleModeShortcut: KeyName[]
  setCycleModeShortcut: (keys: KeyName[]) => void
  setShareAnalytics: (share: boolean) => void
  setLaunchAtLogin: (launch: boolean) => void
  setShowItoBarAlways: (show: boolean) => void
  setShowAppInDock: (show: boolean) => void
  setRunInBackground: (enabled: boolean) => void
  setInteractionSounds: (enabled: boolean) => void
  setInteractionSoundTheme: (theme: InteractionSoundTheme) => void
  setMuteAudioWhenDictating: (enabled: boolean) => void
  setPasteCombo: (combo: SettingsState['pasteCombo']) => void
  setMicrophoneDeviceId: (deviceId: string, name: string) => void
  setTheme: (theme: 'light' | 'dark' | 'system') => void
  createKeyboardShortcut: (modeId: string) => ShortcutResult
  /** Crée ou réattribue le raccourci qui suit le mode actif. */
  setActiveModeShortcut: (keys: KeyName[]) => Promise<ShortcutResult>
  removeKeyboardShortcut: (shortcutId: string) => void
  getModeShortcuts: (modeId: string) => KeyboardShortcutConfig[]
  updateKeyboardShortcut: (
    shortcutId: string,
    keys: KeyName[],
  ) => Promise<ShortcutResult>
}

type SettingCategory = 'general' | 'audio&mic' | 'keyboard' | 'account' | 'ui'

// Initialize from electron store
const getInitialState = () => {
  const storedSettings = window.electron.store.get(STORE_KEYS.SETTINGS)

  return {
    shareAnalytics: storedSettings?.shareAnalytics ?? true,
    launchAtLogin: storedSettings?.launchAtLogin ?? true,
    showItoBarAlways: storedSettings?.showItoBarAlways ?? true,
    showAppInDock: storedSettings?.showAppInDock ?? true,
    runInBackground: storedSettings?.runInBackground ?? true,
    interactionSounds: storedSettings?.interactionSounds ?? false,
    interactionSoundTheme: storedSettings?.interactionSoundTheme ?? 'pop',
    muteAudioWhenDictating: storedSettings?.muteAudioWhenDictating ?? true,
    pasteCombo: storedSettings?.pasteCombo ?? 'auto',
    microphoneDeviceId: storedSettings?.microphoneDeviceId ?? 'default',
    microphoneName: storedSettings?.microphoneName ?? 'Default Microphone',
    theme: storedSettings?.theme ?? 'dark',
    keyboardShortcuts: storedSettings?.keyboardShortcuts ?? [
      {
        keys: MODE_SHORTCUT_DEFAULTS.intelligent,
        modeId: 'intelligent',
        id: crypto.randomUUID(),
      },
      {
        keys: MODE_SHORTCUT_DEFAULTS['voice-to-text'],
        modeId: 'voice-to-text',
        id: crypto.randomUUID(),
      },
    ],
    // Ships unbound — see the matching default in lib/main/store.ts.
    cycleModeShortcut: storedSettings?.cycleModeShortcut ?? [],
    firstName: storedSettings?.firstName ?? '',
    lastName: storedSettings?.lastName ?? '',
    email: storedSettings?.email ?? '',
  }
}

// Sync to electron store
const syncToStore = (state: Partial<SettingsState>) => {
  const currentSettings = window.electron.store.get(STORE_KEYS.SETTINGS) || {}

  // A much simpler and more robust way to merge the settings.
  // This takes all existing settings and overwrites them with only the keys
  // present in the new partial state, without accidentally unsetting others.
  const updatedSettings = {
    ...currentSettings,
    ...state,
  }

  window.electron.store.set(STORE_KEYS.SETTINGS, updatedSettings)

  // Notify pill window of settings changes
  if (window.api?.notifySettingsUpdate) {
    window.api.notifySettingsUpdate(updatedSettings)
  }

  // Re-register hotkeys when keyboard shortcuts change
  if ('keyboardShortcuts' in state && window.api?.registerHotkeys) {
    window.api.registerHotkeys()
  }
}

/**
 * Les deux vérifications qu'un accord doit passer avant d'être écrit : la
 * combinaison n'est pas réservée par l'OS, et elle n'est pas déjà prise.
 *
 * Partagée par la mise à jour d'un raccourci et par la création du raccourci
 * par défaut : deux chemins d'écriture qui ne doivent pas juger différemment.
 */
async function validateChord(
  currentShortcuts: KeyboardShortcutConfig[],
  shortcut: KeyboardShortcutConfig,
  keys: KeyName[],
): Promise<{ keys: KeyName[]; error?: ShortcutResult }> {
  const normalizedKeys = normalizeChord(keys)
  const platform = await window.api.getPlatform()

  const reservedCheck = isReservedCombination(normalizedKeys, platform)
  if (reservedCheck.isReserved) {
    return {
      keys: normalizedKeys,
      error: {
        success: false,
        error: 'reserved-combination',
        errorMessage: reservedCheck.reason,
      },
    }
  }

  const duplicateError = validateShortcutForDuplicate(
    currentShortcuts,
    { ...shortcut, keys: normalizedKeys },
    shortcut.modeId,
  )
  if (duplicateError) return { keys: normalizedKeys, error: duplicateError }

  return { keys: normalizedKeys }
}

export const useSettingsStore = create<SettingsState>(set => {
  const initialState = getInitialState()

  // Helper for single-property setters
  const createSetter =
    <K extends keyof SettingsState>(
      key: K,
      settingCategory: SettingCategory = 'general',
    ) =>
    (value: SettingsState[K]) => {
      const currentValue = useSettingsStore.getState()[key]
      const partialState = { [key]: value } as Partial<SettingsState>
      analytics.trackSettings(ANALYTICS_EVENTS.SETTING_CHANGED, {
        setting_name: key as string,
        old_value: currentValue,
        new_value: value,
        setting_category: settingCategory,
      })
      set(partialState)
      syncToStore(partialState)
    }

  return {
    ...initialState,
    setShareAnalytics: (share: boolean) => {
      const partialState = { shareAnalytics: share }
      set(partialState)
      syncToStore(partialState)
      // Update analytics when setting changes
      updateAnalyticsFromSettings(share)
    },
    setLaunchAtLogin: (launch: boolean) => {
      const currentValue = useSettingsStore.getState().launchAtLogin
      const partialState = { launchAtLogin: launch }
      analytics.trackSettings(ANALYTICS_EVENTS.SETTING_CHANGED, {
        setting_name: 'launchAtLogin',
        old_value: currentValue,
        new_value: launch,
        setting_category: 'general',
      })
      set(partialState)
      syncToStore(partialState)
      if (window.api?.loginItem?.setSettings) {
        window.api.loginItem.setSettings(launch)
      }
    },
    setShowItoBarAlways: createSetter('showItoBarAlways', 'general'),
    setShowAppInDock: (show: boolean) => {
      const currentValue = useSettingsStore.getState().showAppInDock
      const partialState = { showAppInDock: show }
      // Track setting change
      analytics.trackSettings(ANALYTICS_EVENTS.SETTING_CHANGED, {
        setting_name: 'showAppInDock',
        old_value: currentValue,
        new_value: show,
        setting_category: 'ui',
      })

      set(partialState)
      syncToStore(partialState)
      if (window.api?.dock?.setVisibility) {
        window.api.dock.setVisibility(show)
      }
    },
    setRunInBackground: createSetter('runInBackground', 'general'),
    setInteractionSounds: createSetter('interactionSounds', 'audio&mic'),
    setInteractionSoundTheme: createSetter(
      'interactionSoundTheme',
      'audio&mic',
    ),
    setMuteAudioWhenDictating: createSetter(
      'muteAudioWhenDictating',
      'audio&mic',
    ),
    setPasteCombo: createSetter('pasteCombo', 'general'),
    setMicrophoneDeviceId: (deviceId: string, name: string) => {
      const currentName = useSettingsStore.getState().microphoneName
      analytics.trackSettings(ANALYTICS_EVENTS.MICROPHONE_CHANGED, {
        setting_name: 'microphoneName',
        old_value: currentName,
        new_value: name,
        setting_category: 'audio&mic',
      })
      const partialState = {
        microphoneDeviceId: deviceId,
        microphoneName: name,
      }
      set(partialState)
      syncToStore(partialState)
    },
    setTheme: createSetter('theme', 'ui'),
    setCycleModeShortcut: (keys: KeyName[]) => {
      set(() => {
        const partialState = { cycleModeShortcut: normalizeChord(keys) }
        syncToStore(partialState)
        return partialState
      })
    },
    createKeyboardShortcut: (modeId: string): ShortcutResult => {
      const currentShortcuts = useSettingsStore.getState().keyboardShortcuts

      const newShortcut = {
        keys: [],
        modeId,
        id: crypto.randomUUID(),
      }

      const newShortcuts = [...currentShortcuts, newShortcut]
      const partialState = {
        keyboardShortcuts: newShortcuts,
      }
      // Track keyboard shortcut change
      analytics.trackSettings(ANALYTICS_EVENTS.KEYBOARD_SHORTCUTS_CHANGED, {
        setting_name: 'keyboardShortcuts',
        old_value: currentShortcuts,
        new_value: newShortcuts,
        setting_category: 'input',
      })

      // Update user properties
      analytics.updateUserProperties({
        keyboard_shortcuts: newShortcuts.map(ks => JSON.stringify(ks)),
      })
      set(partialState)
      syncToStore(partialState)
      return { success: true }
    },
    removeKeyboardShortcut: (shortcutId: string) => {
      const currentShortcuts = useSettingsStore.getState().keyboardShortcuts
      const newShortcuts = currentShortcuts.filter(ks => ks.id !== shortcutId)
      const partialState = {
        keyboardShortcuts: newShortcuts,
      }
      // Track keyboard shortcut change
      analytics.trackSettings(ANALYTICS_EVENTS.KEYBOARD_SHORTCUTS_CHANGED, {
        setting_name: 'keyboardShortcuts',
        old_value: currentShortcuts,
        new_value: newShortcuts,
        setting_category: 'input',
      })

      // Update user properties
      analytics.updateUserProperties({
        keyboard_shortcuts: newShortcuts.map(ks => JSON.stringify(ks)),
      })
      set(partialState)
      syncToStore(partialState)
    },
    getModeShortcuts: (modeId: string) => {
      const { keyboardShortcuts } = useSettingsStore.getState()
      return keyboardShortcuts.filter(ks => ks.modeId === modeId)
    },
    /**
     * Le raccourci de dictée par défaut : celui qui ne nomme aucun mode et suit
     * le mode actif. Il n'y en a qu'un, créé à la première attribution — d'où
     * cette action plutôt qu'un passage par `createKeyboardShortcut`, qui
     * laisserait une ligne vide derrière lui si la validation refusait l'accord.
     */
    setActiveModeShortcut: async (keys: KeyName[]): Promise<ShortcutResult> => {
      const currentShortcuts = useSettingsStore.getState().keyboardShortcuts
      const existing = currentShortcuts.find(ks => ks.modeId === null)

      if (existing) {
        return useSettingsStore
          .getState()
          .updateKeyboardShortcut(existing.id, keys)
      }

      const created: KeyboardShortcutConfig = {
        id: ACTIVE_MODE_SHORTCUT_ID,
        keys: [],
        modeId: null,
      }
      const validation = await validateChord(currentShortcuts, created, keys)
      if (validation.error) return validation.error

      const newShortcuts = [
        ...currentShortcuts,
        { ...created, keys: validation.keys },
      ]
      set({ keyboardShortcuts: newShortcuts })
      syncToStore({ keyboardShortcuts: newShortcuts })
      return { success: true }
    },
    updateKeyboardShortcut: async (
      shortcutId: string,
      keys: KeyName[],
    ): Promise<ShortcutResult> => {
      const currentShortcuts = useSettingsStore.getState()
        .keyboardShortcuts as KeyboardShortcutConfig[]

      const shortcut = currentShortcuts.find(ks => ks.id === shortcutId)

      if (!shortcut) {
        return { success: false, error: 'not-found' }
      }

      const { keys: normalizedKeys, error } = await validateChord(
        currentShortcuts,
        shortcut,
        keys,
      )
      if (error) return error

      const updatedShortcuts = currentShortcuts.map(ks =>
        ks.id === shortcutId ? { ...ks, keys: normalizedKeys } : ks,
      )
      const partialState = {
        keyboardShortcuts: updatedShortcuts,
      }
      // Track keyboard shortcut change
      analytics.trackSettings(ANALYTICS_EVENTS.KEYBOARD_SHORTCUTS_CHANGED, {
        setting_name: 'keyboardShortcuts',
        old_value: currentShortcuts,
        new_value: updatedShortcuts,
        setting_category: 'input',
      })

      // Update user properties
      analytics.updateUserProperties({
        keyboard_shortcuts: updatedShortcuts.map(ks => JSON.stringify(ks)),
      })
      set(partialState)
      syncToStore(partialState)

      return { success: true }
    },
  }
})

if (typeof window !== 'undefined' && window.api?.loginItem?.getSettings) {
  window.api.loginItem
    .getSettings()
    .then(settings => {
      const storedSettings = window.electron.store.get(STORE_KEYS.SETTINGS)
      if (settings.openAtLogin !== storedSettings?.launchAtLogin) {
        useSettingsStore.getState().setLaunchAtLogin(settings.openAtLogin)
      }
    })
    .catch(error => {
      console.error(
        'Failed to sync login item settings on initialization:',
        error,
      )
    })
}

// `keyboardShortcuts` is read once at module load (getInitialState) and
// otherwise only ever changes through this store's own setters — it has no
// way to learn about a main-side write, such as a mode delete pruning that
// mode's shortcut from the store on disk. Left unhandled, the next
// create/update/remove here merges this stale in-memory array back over the
// main process's filtered one and resurrects the deleted shortcut. Refetch
// straight from the (synchronous) electron-store on this signal rather than
// trusting a payload, so this can never itself drift from what's on disk.
if (typeof window !== 'undefined' && window.api?.on) {
  window.api.on(IPC_EVENTS.KEYBOARD_SHORTCUTS_UPDATE, () => {
    const storedSettings = window.electron.store.get(STORE_KEYS.SETTINGS)
    useSettingsStore.setState({
      keyboardShortcuts: storedSettings?.keyboardShortcuts ?? [],
    })
  })
}

if (typeof window !== 'undefined' && window.api?.dock?.getVisibility) {
  window.api.invoke('init-window').then((windowInfo: any) => {
    if (windowInfo.platform === 'darwin') {
      window.api.dock
        .getVisibility()
        .then(dockSettings => {
          const storedSettings = window.electron.store.get(STORE_KEYS.SETTINGS)
          if (dockSettings.isVisible !== storedSettings?.showAppInDock) {
            useSettingsStore.getState().setShowAppInDock(dockSettings.isVisible)
          }
        })
        .catch(error => {
          console.error(
            'Failed to sync dock visibility on initialization:',
            error,
          )
        })
    }
  })
}
