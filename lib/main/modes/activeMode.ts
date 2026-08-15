import store, { getCurrentUserId } from '../store'
import { STORE_KEYS } from '../../constants/store-keys'
import { ModesTable } from './ModeRepository'
import type { Mode } from '../sqlite/models'

/**
 * Le mode actif : celui qu'une dictée utilise quand aucun raccourci dédié ne
 * l'a court-circuitée.
 *
 * Toutes les résolutions replient sur le premier mode plutôt que de rendre
 * `undefined`. Une dictée perdue parce que le mode sélectionné a été supprimé
 * serait un échec bien pire que d'être transcrite par le mauvais mode.
 */

const userId = () => getCurrentUserId() || 'self-hosted'

export function getActiveModeId(): string | undefined {
  return (store.get(STORE_KEYS.SETTINGS) as any)?.activeModeId
}

export function setActiveModeId(id: string): void {
  const settings: any = store.get(STORE_KEYS.SETTINGS) || {}
  store.set(STORE_KEYS.SETTINGS, { ...settings, activeModeId: id })
}

export async function resolveMode(modeId: string | undefined): Promise<Mode> {
  if (modeId) {
    const mode = await ModesTable.findById(modeId)
    if (mode) return mode
    console.warn(`[activeMode] Mode "${modeId}" is gone, falling back`)
  }

  const modes = await ModesTable.findAll(userId())
  if (modes.length === 0) {
    throw new Error('No mode available — the seeder did not run')
  }
  return modes[0]
}

export function resolveActiveMode(): Promise<Mode> {
  return resolveMode(getActiveModeId())
}

export async function cycleActiveMode(direction: 1 | -1 = 1): Promise<Mode> {
  const modes = await ModesTable.findAll(userId())
  if (modes.length === 0) {
    throw new Error('No mode available — the seeder did not run')
  }

  const current = getActiveModeId()
  const index = modes.findIndex(mode => mode.id === current)
  const next = modes[(index + direction + modes.length) % modes.length]

  setActiveModeId(next.id)
  console.log(`[activeMode] Active mode is now "${next.name}"`)
  return next
}
