import { create } from 'zustand'
import type { ModeDto } from '../index'
import type { ActiveModePayload } from '@/lib/types/ipc'

interface ModesStore {
  modes: ModeDto[]
  activeModeId: string | undefined
  loaded: boolean
  load: () => Promise<void>
  create: (preset: string, name: string) => Promise<ModeDto>
  update: (id: string, patch: Partial<ModeDto>) => Promise<void>
  /** Optimistic-only half of `update`, for callers that debounce the persist
   *  themselves (the mode editor's free-text fields) but still want every
   *  keystroke to show up immediately. */
  updateLocal: (id: string, patch: Partial<ModeDto>) => void
  remove: (id: string) => Promise<{ ok: boolean; error?: string }>
  duplicate: (id: string) => Promise<void>
  setActive: (id: string) => Promise<void>
}

export const useModesStore = create<ModesStore>((set, get) => ({
  modes: [],
  activeModeId: undefined,
  loaded: false,

  load: async () => {
    const [modes, activeModeId] = await Promise.all([
      window.api.modes.getAll(),
      window.api.modes.getActive(),
    ])
    set({ modes, activeModeId: activeModeId ?? modes[0]?.id, loaded: true })
  },

  create: async (preset, name) => {
    const mode = await window.api.modes.create(preset, name)
    set(state => ({ modes: [...state.modes, mode] }))
    return mode
  },

  // Optimiste : l'éditeur écrit à chaque frappe, attendre le disque ferait
  // sautiller le curseur.
  update: async (id, patch) => {
    set(state => ({
      modes: state.modes.map(mode =>
        mode.id === id ? { ...mode, ...patch } : mode,
      ),
    }))
    try {
      await window.api.modes.update(id, patch)
    } catch (error) {
      // The optimistic set above already lied to the editor. Reload from the
      // main process — the source of truth — so it stops showing a value
      // that was never actually written, instead of leaving an unhandled
      // rejection and a stale UI.
      console.error('Failed to persist mode update:', error)
      await get().load()
    }
  },

  updateLocal: (id, patch) => {
    set(state => ({
      modes: state.modes.map(mode =>
        mode.id === id ? { ...mode, ...patch } : mode,
      ),
    }))
  },

  remove: async id => {
    const result = await window.api.modes.delete(id)
    if (result.ok) await get().load()
    return result
  },

  duplicate: async id => {
    await window.api.modes.duplicate(id)
    await get().load()
  },

  setActive: async id => {
    set({ activeModeId: id })
    await window.api.modes.setActive(id)
  },
}))

// Le processus principal diffuse ce changement quand le mode actif bouge par
// un chemin que ce store n'initie pas — l'accord global de défilement. Sans
// cet abonnement, la pastille active de la page Modes et la pill restent sur
// l'ancien mode jusqu'au redémarrage.
if (typeof window !== 'undefined' && window.api?.on) {
  window.api.on('active-mode-update', (payload: ActiveModePayload) => {
    useModesStore.setState(state => ({
      activeModeId: payload.modeId,
      // The pill reads a mode's name via `modes.find(activeModeId)`, not
      // from this payload — without patching the cached copy here, a rename
      // broadcast updated only `activeModeId` and the pill kept showing the
      // old name until the next full `load()` (i.e. a restart).
      modes: state.modes.map(mode =>
        mode.id === payload.modeId
          ? { ...mode, name: payload.modeName, icon: payload.modeIcon }
          : mode,
      ),
    }))
  })
}
