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
 * supprimées, donc un simple test de présence via elle ferait revenir les
 * morts (d'où `findAllIdsIncludingDeleted` ci-dessous, qui les voit).
 *
 * `modes.id` est une clé primaire globale, pas composée avec `user_id` : si
 * le preset existe déjà sous un autre utilisateur (ex. `self-hosted`, semé
 * avant qu'un compte se connecte), l'insertion entrerait en conflit de clé.
 * On rapatrie alors la ligne vers l'utilisateur courant au lieu d'en créer
 * un doublon — voir le commentaire sur `reassignOwner`.
 *
 * `meeting` est dans `SEEDED_PRESET_KEYS` depuis que son modèle vocal a un
 * chemin Deepgram viable ; les installations qui ont déjà consommé le
 * drapeau de ce seed avant son arrivée sont rattrapées séparément par
 * `seedMeetingMode`, plus bas dans ce fichier.
 *
 * Ne lance jamais : une erreur ici (SQLite, store, ou autre) ne doit jamais
 * empêcher l'application de démarrer. `initializeStore` attend cette
 * promesse et son appelant réagit à un rejet en tuant l'app (`app.quit()`
 * dans `main.ts`) — un lancement sans modes est un état dégradé dont
 * l'utilisateur peut se remettre (recréer un mode à la main), un
 * `app.quit()` au démarrage ne l'est pas. Le garde-fou vit ici plutôt qu'à
 * l'appel dans `store.ts` pour protéger tout appelant présent ou futur, pas
 * seulement celui-là.
 */
export async function seedModes(userId: string): Promise<number> {
  try {
    // Modes are scoped by user_id, but signing in swaps userProfile.id
    // (lib/auth/events.ts) to a different user. A global flag would see that
    // user as already seeded and refuse to run, leaving them with zero modes
    // — so the flag itself is keyed per user.
    const seedFlag = `${SEED_ID}:${userId}`
    if (hasRunOnce(seedFlag)) {
      markRunOnce(seedFlag)
      return 0
    }

    // Bridge for installs that ran the seeder before the flag was keyed per
    // user: they set the global `SEED_ID` flag. Without this, every one of
    // them looks unseeded on next launch and re-seeds — a no-op if every
    // preset survives, but a collision (or a resurrected preset, if we only
    // guarded via `findAllIdsIncludingDeleted`) the moment the user deleted
    // one. Treat them as already seeded and move straight to the keyed flag.
    if (hasRunOnce(SEED_ID)) {
      markRunOnce(seedFlag)
      return 0
    }

    // Includes soft-deleted rows — see the file header comment.
    const existingIds = new Set(
      await ModesTable.findAllIdsIncludingDeleted(userId),
    )
    let created = 0

    for (const [index, key] of SEEDED_PRESET_KEYS.entries()) {
      if (existingIds.has(key)) continue

      const preset = findPreset(key)
      if (!preset) continue

      const owner = await ModesTable.findOwner(key)
      if (owner && owner !== userId) {
        await ModesTable.reassignOwner(key, userId)
        continue
      }

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

    markRunOnce(seedFlag)
    console.log(`[modeSeeder] Seeded ${created} mode(s)`)
    return created
  } catch (error) {
    console.error('[modeSeeder] Failed to seed modes:', error)
    return 0
  }
}

const MEETING_SEED_ID = '2026-08-14-seed-meeting'

/**
 * Sème le mode Meeting, une fois seulement.
 *
 * `meeting` figure désormais dans `SEEDED_PRESET_KEYS`, donc une
 * installation fraîche le reçoit déjà via la boucle de `seedModes`. Cette
 * fonction existe pour les installations qui ont consommé le drapeau du
 * premier seed avant que Meeting rejoigne l'ensemble : elles ne relanceront
 * jamais cette boucle, donc sans un drapeau propre à Meeting elles ne
 * l'auraient jamais. Un id et un drapeau distincts (`MEETING_SEED_ID`) sont
 * indispensables pour ça.
 *
 * Mêmes garanties que `seedModes` et pour les mêmes raisons : drapeau par
 * utilisateur (une connexion change `userId`), présence testée via
 * `findAllIdsIncludingDeleted` pour ne jamais ressusciter un Meeting
 * supprimé, ré-attribution plutôt que ré-insertion si `meeting` existe déjà
 * sous un autre utilisateur (`modes.id` est une clé globale), et jamais de
 * rejet — une erreur ici ne doit pas pouvoir empêcher le démarrage.
 */
export async function seedMeetingMode(userId: string): Promise<number> {
  try {
    const seedFlag = `${MEETING_SEED_ID}:${userId}`
    if (hasRunOnce(seedFlag)) return 0

    // Includes soft-deleted rows — see the file header comment on seedModes.
    const existingIds = new Set(
      await ModesTable.findAllIdsIncludingDeleted(userId),
    )
    if (existingIds.has('meeting')) {
      markRunOnce(seedFlag)
      return 0
    }

    const preset = findPreset('meeting')
    if (!preset) {
      markRunOnce(seedFlag)
      return 0
    }

    const owner = await ModesTable.findOwner('meeting')
    if (owner && owner !== userId) {
      await ModesTable.reassignOwner('meeting', userId)
      markRunOnce(seedFlag)
      return 0
    }

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
      sortOrder: existingIds.size,
    })

    markRunOnce(seedFlag)
    console.log('[modeSeeder] Seeded the Meeting mode')
    return 1
  } catch (error) {
    console.error('[modeSeeder] Failed to seed the Meeting mode:', error)
    return 0
  }
}
