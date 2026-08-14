import store from '../store'
import { STORE_KEYS } from '../../constants/store-keys'
import { hasRunOnce, markRunOnce } from './modeSeeder'

/**
 * Les raccourcis pointaient vers une valeur de l'enum `ItoMode` ; ils pointent
 * désormais vers l'id d'un mode.
 *
 * C'est la migration la plus risquée du chantier : si elle se trompe, le
 * symptôme est « mon raccourci ne fait plus rien », le pire à diagnostiquer.
 * D'où le repli sur `voice-to-text` plutôt qu'un abandon du raccourci quand la
 * valeur d'origine est inconnue — un raccourci qui déclenche le mauvais mode
 * se voit et se corrige, un raccourci muet ressemble à une app cassée.
 */
const MIGRATION_ID = '2026-08-14-shortcuts-to-mode-ids'

export const LEGACY_MODE_IDS: Record<number, string> = {
  0: 'voice-to-text',
  1: 'intelligent',
}

export function migrateShortcutsToModeIds(): void {
  if (hasRunOnce(MIGRATION_ID)) return

  const settings: any = store.get(STORE_KEYS.SETTINGS) || {}
  const shortcuts: any[] = Array.isArray(settings.keyboardShortcuts)
    ? settings.keyboardShortcuts
    : []

  const migrated = shortcuts.map(shortcut => {
    const { mode, ...rest } = shortcut
    return {
      ...rest,
      modeId: shortcut.modeId ?? LEGACY_MODE_IDS[mode] ?? LEGACY_MODE_IDS[0],
    }
  })

  store.set(STORE_KEYS.SETTINGS, {
    ...settings,
    keyboardShortcuts: migrated,
  })
  markRunOnce(MIGRATION_ID)
  console.log(
    `[shortcutMigration] Rebound ${migrated.length} shortcut(s) to mode ids`,
  )
}
