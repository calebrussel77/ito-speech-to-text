import { create } from 'zustand'
import { STORE_KEYS } from '../../lib/constants/store-keys'
import { IPC_EVENTS } from '@/lib/types/ipc'

type PageType =
  | 'home'
  | 'modes'
  | 'models'
  | 'dictionary'
  | 'notes'
  | 'settings'
  | 'about'
type SettingsPageType =
  | 'general'
  | 'keyboard'
  | 'audio'
  | 'account'
  | 'models'
  | 'advanced'
  | 'pricing-billing'

interface MainStore {
  navExpanded: boolean
  currentPage: PageType
  settingsPage: SettingsPageType
  toggleNavExpanded: () => void
  setCurrentPage: (page: PageType) => void
  setSettingsPage: (page: SettingsPageType) => void
}

// Initialize from electron store
const getInitialState = () => {
  const storedMain = window.electron.store.get(STORE_KEYS.MAIN)

  return {
    navExpanded: storedMain?.navExpanded ?? true,
    currentPage: (storedMain?.currentPage as PageType) ?? 'home',
    settingsPage: (storedMain?.settingsPage as SettingsPageType) ?? 'general',
  }
}

// Sync to electron store
const syncToStore = (state: Partial<MainStore>) => {
  const currentStore = window.electron.store.get(STORE_KEYS.MAIN) || {}
  const updates: any = { ...currentStore }

  if ('navExpanded' in state) {
    updates.navExpanded = state.navExpanded ?? currentStore.navExpanded
  }

  if ('settingsPage' in state) {
    updates.settingsPage = state.settingsPage ?? currentStore.settingsPage
  }

  window.electron.store.set(STORE_KEYS.MAIN, updates)
}

export const useMainStore = create<MainStore>(set => {
  const initialState = getInitialState()
  return {
    navExpanded: initialState.navExpanded,
    currentPage: 'home',
    settingsPage: initialState.settingsPage,
    toggleNavExpanded: () =>
      set(state => {
        const newState = { navExpanded: !state.navExpanded }
        syncToStore(newState)
        return newState
      }),
    setCurrentPage: (page: PageType) => set({ currentPage: page }),
    setSettingsPage: (page: SettingsPageType) => {
      const newState = { settingsPage: page }
      syncToStore(newState)
      set(newState)
    },
  }
})

// Le processus principal ouvre la fenêtre sur une page quand un travail long
// se termine ailleurs — le clic sur la notification d'une transcription de
// fichier, qui doit mener au résultat et pas seulement réveiller la fenêtre.
if (typeof window !== 'undefined' && window.api?.on) {
  window.api.on(IPC_EVENTS.OPEN_PAGE, (page: PageType) => {
    useMainStore.getState().setCurrentPage(page)
  })
}
