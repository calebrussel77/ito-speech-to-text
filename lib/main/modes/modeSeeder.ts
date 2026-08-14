import { SEEDED_PRESET_KEYS, findPreset } from '../../constants/modePresets'
import { ModesTable } from './ModeRepository'
import store from '../store'

/**
 * Persistance « déjà fait », adossée à `appliedMigrations`.
 *
 * `store.set` écrit bien en base, mais `initializeStore` ne recharge qu'une
 * liste blanche fermée (`lib/main/store.ts:537-550`) : une clé top-level qui
 * n'y figure pas vaut `undefined` à chaque démarrage. `appliedMigrations` y
 * est, et porte déjà exactement cette sémantique — inutile d'inventer un
 * second mécanisme qui, lui, ne survivrait pas au redémarrage.
 */
export function hasRunOnce(id: string): boolean {
  const applied = store.get('appliedMigrations')
  return Array.isArray(applied) && applied.includes(id)
}

export function markRunOnce(id: string): void {
  const applied = store.get('appliedMigrations')
  const list = Array.isArray(applied) ? applied : []
  if (list.includes(id)) return
  store.set('appliedMigrations', [...list, id])
}

const SEED_ID = '2026-08-14-seed-modes'

/**
 * Sème les modes de départ.
 *
 * Idempotent par deux mécanismes complémentaires : on ne crée que les ids
 * absents, et le drapeau persistant empêche de re-semer un mode que
 * l'utilisateur a délibérément supprimé — `findAll` ne voit pas les lignes
 * supprimées, donc le seul test d'absence ferait revenir les morts.
 *
 * `meeting` n'est pas dans `SEEDED_PRESET_KEYS` à ce stade : son modèle vocal
 * n'a de chemin viable qu'au lot 3.
 */
export async function seedModes(userId: string): Promise<number> {
  if (hasRunOnce(SEED_ID)) {
    markRunOnce(SEED_ID)
    return 0
  }

  const existing = await ModesTable.findAll(userId)
  const existingIds = new Set(existing.map(mode => mode.id))
  let created = 0

  for (const [index, key] of SEEDED_PRESET_KEYS.entries()) {
    if (existingIds.has(key)) continue

    const preset = findPreset(key)
    if (!preset) continue

    await ModesTable.insert({
      id: preset.key,
      userId,
      name: preset.label,
      preset: preset.key,
      icon: preset.icon,
      instructions: preset.instructions,
      language: preset.language,
      voiceModelKey: preset.voiceModelKey,
      textModelKey: preset.textModelKey,
      useLlm: preset.useLlm,
      contextApplication: preset.contextApplication,
      contextClipboard: preset.contextClipboard,
      contextSelection: preset.contextSelection,
      audioSource: preset.audioSource,
      playbackWhenRecording: preset.playbackWhenRecording,
      autoPaste: preset.autoPaste,
      autocapitalize: preset.autocapitalize,
      identifySpeakers: preset.identifySpeakers,
      asrPrompt: preset.asrPrompt,
      sortOrder: index,
    })
    created++
  }

  markRunOnce(SEED_ID)
  console.log(`[modeSeeder] Seeded ${created} mode(s)`)
  return created
}
