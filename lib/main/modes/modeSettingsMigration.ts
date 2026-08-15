import store from '../store'
import { STORE_KEYS } from '../../constants/store-keys'
import { ModesTable } from './ModeRepository'
import { hasRunOnce, markRunOnce } from './modeSeeder'
import type { ModeLanguageValue } from '../sqlite/models'

/**
 * Déverse dans les modes les réglages qui étaient globaux.
 *
 * Le point sensible : `shortVoiceModelKey` et `longVoiceModelKey` sont le
 * résultat d'un banc de mesure sur les vraies dictées de Caleb. Les perdre en
 * chemin le renverrait sur des défauts qu'il n'a pas choisis — d'où le
 * fléchage explicite court → « Voice to text », long → « Intelligent », qui
 * reproduit exactement son réglage.
 *
 * Strictement une fois. Elle supprime `asrLanguage` en fin de course ; un
 * second passage lirait une valeur absente et réécrirait `language: 'auto'`
 * sur tous les modes en écrasant leur `textModelKey`.
 */
const MIGRATION_ID = '2026-08-14-settings-into-modes'

const SUPPORTED_LANGUAGES: ModeLanguageValue[] = ['fr', 'en', 'es', 'auto']

export async function migrateSettingsIntoModes(): Promise<void> {
  if (hasRunOnce(MIGRATION_ID)) return

  const advanced: any = store.get(STORE_KEYS.ADVANCED_SETTINGS) || {}
  const llm: any = advanced.llm || {}

  // These four keys only ever existed on a pre-modes store; a fresh install
  // never wrote them. Without this guard the migration still "runs once" on
  // a fresh install too — against the presets the seeder just wrote minutes
  // earlier, each with its own deliberately different language and model —
  // and flattens them to the global defaults. Marking the flag and returning
  // here (rather than skipping it) keeps that a genuine one-shot: nothing
  // legacy will ever appear later to retrigger it.
  if (
    !(
      'asrLanguage' in llm ||
      'asrPrompt' in llm ||
      'editingPrompt' in llm ||
      'transcriptionPrompt' in llm
    )
  ) {
    markRunOnce(MIGRATION_ID)
    return
  }

  const modes = await ModesTable.findAll(
    (store.get(STORE_KEYS.USER_PROFILE) as any)?.id || 'self-hosted',
  )

  const asrPrompt: string = (llm.asrPrompt || '').trim()
  const rawLanguage: string = (llm.asrLanguage || '').trim()
  const language: ModeLanguageValue = SUPPORTED_LANGUAGES.includes(
    rawLanguage as ModeLanguageValue,
  )
    ? (rawLanguage as ModeLanguageValue)
    : 'auto'
  const editingPrompt: string = (llm.editingPrompt || '').trim()

  const voiceModelByMode: Record<string, string | undefined> = {
    'voice-to-text': advanced.shortVoiceModelKey,
    intelligent: advanced.longVoiceModelKey,
  }

  for (const mode of modes) {
    const patch: Record<string, unknown> = { language }

    if (asrPrompt) patch.asrPrompt = asrPrompt
    if (voiceModelByMode[mode.id]) {
      patch.voiceModelKey = voiceModelByMode[mode.id]
    }
    if (mode.useLlm && advanced.textModelKey) {
      patch.textModelKey = advanced.textModelKey
    }
    if (mode.id === 'intelligent' && editingPrompt) {
      patch.instructions = editingPrompt
    }

    await ModesTable.update(mode.id, patch as any)
  }

  // Ce qui a déménagé ou qui était mort quitte les réglages : deux endroits
  // pour la même valeur est la garantie qu'ils divergeront.
  const nextLlm = { ...llm }
  delete nextLlm.editingPrompt
  delete nextLlm.transcriptionPrompt
  delete nextLlm.asrPrompt
  delete nextLlm.asrLanguage

  const next = { ...advanced, llm: nextLlm }
  delete next.shortVoiceModelKey
  delete next.longVoiceModelKey
  delete next.longDictationEnabled
  delete next.longDictationThresholdMs

  store.set(STORE_KEYS.ADVANCED_SETTINGS, next)
  markRunOnce(MIGRATION_ID)
  console.log('[modeSettingsMigration] Global settings moved into modes')
}
