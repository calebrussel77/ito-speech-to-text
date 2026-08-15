import { v4 as uuidv4 } from 'uuid'
import { run, get, all } from '../sqlite/utils'
import type { Mode, ModeExample, ModeRow } from '../sqlite/models'

/**
 * Accès SQLite aux modes.
 *
 * SQLite n'a pas de booléen : la conversion 0/1 ↔ `boolean` vit ici et
 * nulle part ailleurs, pour que le reste de l'application ne manipule jamais
 * un « 1 » qui veut dire « vrai ».
 */

const bool = (value: number | null | undefined) => value === 1
const int = (value: boolean) => (value ? 1 : 0)

const COLUMNS = [
  'id',
  'user_id',
  'name',
  'preset',
  'icon',
  'instructions',
  'language',
  'voice_model_key',
  'text_model_key',
  'use_llm',
  'context_application',
  'context_clipboard',
  'context_selection',
  'audio_source',
  'playback_when_recording',
  'auto_paste',
  'autocapitalize',
  'identify_speakers',
  'asr_prompt',
  'sort_order',
  'color',
  'created_at',
  'updated_at',
  'deleted_at',
] as const

/** Nom de colonne pour chaque champ de `Mode` que `update` accepte. */
const COLUMN_OF: Record<string, string> = {
  name: 'name',
  preset: 'preset',
  icon: 'icon',
  instructions: 'instructions',
  language: 'language',
  voiceModelKey: 'voice_model_key',
  textModelKey: 'text_model_key',
  useLlm: 'use_llm',
  contextApplication: 'context_application',
  contextClipboard: 'context_clipboard',
  contextSelection: 'context_selection',
  audioSource: 'audio_source',
  playbackWhenRecording: 'playback_when_recording',
  autoPaste: 'auto_paste',
  autocapitalize: 'autocapitalize',
  identifySpeakers: 'identify_speakers',
  asrPrompt: 'asr_prompt',
  sortOrder: 'sort_order',
  color: 'color',
}

function toMode(row: ModeRow): Mode {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    preset: row.preset,
    icon: row.icon,
    instructions: row.instructions,
    language: row.language,
    voiceModelKey: row.voice_model_key,
    textModelKey: row.text_model_key,
    useLlm: bool(row.use_llm),
    contextApplication: bool(row.context_application),
    contextClipboard: bool(row.context_clipboard),
    contextSelection: bool(row.context_selection),
    audioSource: row.audio_source,
    playbackWhenRecording: row.playback_when_recording,
    autoPaste: bool(row.auto_paste),
    autocapitalize: bool(row.autocapitalize),
    identifySpeakers: bool(row.identify_speakers),
    asrPrompt: row.asr_prompt,
    sortOrder: row.sort_order,
    color: row.color ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * `color` est facultative à l'insertion : un mode naît sans teinte choisie, et
 * c'est `null` — pas une valeur de la palette — qui le dit. La couleur affichée
 * est alors dérivée de l'id.
 */
export type InsertMode = Omit<Mode, 'createdAt' | 'updatedAt' | 'color'> & {
  id?: string
  color?: string | null
}

export class ModesTable {
  static async findAll(userId: string): Promise<Mode[]> {
    const rows = await all<ModeRow>(
      'SELECT * FROM modes WHERE user_id = ? AND deleted_at IS NULL ORDER BY sort_order ASC, created_at ASC',
      [userId],
    )
    return rows.map(toMode)
  }

  static async findById(id: string): Promise<Mode | undefined> {
    const row = await get<ModeRow>(
      'SELECT * FROM modes WHERE id = ? AND deleted_at IS NULL',
      [id],
    )
    return row ? toMode(row) : undefined
  }

  static async count(userId: string): Promise<number> {
    const row = await get<{ n: number }>(
      'SELECT COUNT(*) as n FROM modes WHERE user_id = ? AND deleted_at IS NULL',
      [userId],
    )
    return row?.n ?? 0
  }

  /**
   * Ids de toutes les lignes de l'utilisateur, supprimées comprises.
   *
   * Le seeder s'en sert pour décider quoi semer : `findAll` masque les
   * lignes supprimées, donc tester la présence contre elle seule ferait
   * revenir un preset que l'utilisateur a délibérément supprimé.
   */
  static async findAllIdsIncludingDeleted(userId: string): Promise<string[]> {
    const rows = await all<{ id: string }>(
      'SELECT id FROM modes WHERE user_id = ?',
      [userId],
    )
    return rows.map(r => r.id)
  }

  /**
   * Le `user_id` propriétaire d'une ligne, tous statuts de suppression
   * confondus — `undefined` si l'id n'existe pas du tout.
   *
   * `modes.id` est une clé primaire globale (pas composée avec `user_id`),
   * donc au plus une ligne existe jamais pour un id de preset donné.
   */
  static async findOwner(id: string): Promise<string | undefined> {
    const row = await get<{ user_id: string }>(
      'SELECT user_id FROM modes WHERE id = ?',
      [id],
    )
    return row?.user_id
  }

  /**
   * Ré-attribue une ligne existante à un autre utilisateur.
   *
   * Sert le seeder : un preset déjà semé sous un ancien `user_id` (ex.
   * `self-hosted`, avant qu'un compte se connecte) doit être rapatrié vers
   * l'utilisateur courant plutôt que ré-inséré — `modes.id` étant une clé
   * globale, une seconde ligne avec le même id serait un conflit de clé
   * primaire, pas un nouveau mode. Rapatrier préserve aussi les éventuelles
   * modifications que l'utilisateur a faites sur ce preset au lieu de les
   * écraser par une réinsertion des valeurs par défaut.
   */
  static async reassignOwner(id: string, userId: string): Promise<void> {
    await run('UPDATE modes SET user_id = ?, updated_at = ? WHERE id = ?', [
      userId,
      new Date().toISOString(),
      id,
    ])
  }

  static async insert(mode: InsertMode): Promise<Mode> {
    const now = new Date().toISOString()
    const created: Mode = {
      ...mode,
      id: mode.id ?? uuidv4(),
      color: mode.color ?? null,
      createdAt: now,
      updatedAt: now,
    }

    await run(
      `INSERT INTO modes (${COLUMNS.join(', ')}) VALUES (${COLUMNS.map(
        () => '?',
      ).join(', ')})`,
      [
        created.id,
        created.userId,
        created.name,
        created.preset,
        created.icon,
        created.instructions,
        created.language,
        created.voiceModelKey,
        created.textModelKey,
        int(created.useLlm),
        int(created.contextApplication),
        int(created.contextClipboard),
        int(created.contextSelection),
        created.audioSource,
        created.playbackWhenRecording,
        int(created.autoPaste),
        int(created.autocapitalize),
        int(created.identifySpeakers),
        created.asrPrompt,
        created.sortOrder,
        created.color,
        created.createdAt,
        created.updatedAt,
        null,
      ],
    )

    return created
  }

  static async update(
    id: string,
    patch: Partial<Omit<Mode, 'id' | 'userId' | 'createdAt' | 'updatedAt'>>,
  ): Promise<void> {
    const assignments: string[] = []
    const params: unknown[] = []

    for (const [field, value] of Object.entries(patch)) {
      const column = COLUMN_OF[field]
      if (!column) continue
      assignments.push(`${column} = ?`)
      params.push(typeof value === 'boolean' ? int(value) : value)
    }

    if (assignments.length === 0) return

    assignments.push('updated_at = ?')
    params.push(new Date().toISOString(), id)

    await run(`UPDATE modes SET ${assignments.join(', ')} WHERE id = ?`, params)
  }

  static async softDelete(id: string): Promise<void> {
    const now = new Date().toISOString()
    await run('UPDATE modes SET deleted_at = ?, updated_at = ? WHERE id = ?', [
      now,
      now,
      id,
    ])
    // `mode_examples` declares ON DELETE CASCADE, but this is an UPDATE, not
    // a DELETE — the cascade never fires. Soft-delete the examples explicitly
    // so they don't outlive their mode.
    await run(
      'UPDATE mode_examples SET deleted_at = ?, updated_at = ? WHERE mode_id = ?',
      [now, now, id],
    )
  }
}

type ModeExampleRow = {
  id: string
  mode_id: string
  spoken_input: string
  ai_output: string
  sort_order: number
  created_at: string
  updated_at: string
  deleted_at: string | null
}

const toExample = (row: ModeExampleRow): ModeExample => ({
  id: row.id,
  modeId: row.mode_id,
  spokenInput: row.spoken_input,
  aiOutput: row.ai_output,
  sortOrder: row.sort_order,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

export class ModeExamplesTable {
  static async findByMode(modeId: string): Promise<ModeExample[]> {
    const rows = await all<ModeExampleRow>(
      'SELECT * FROM mode_examples WHERE mode_id = ? AND deleted_at IS NULL ORDER BY sort_order ASC, created_at ASC',
      [modeId],
    )
    return rows.map(toExample)
  }

  static async insert(example: {
    modeId: string
    spokenInput: string
    aiOutput: string
    sortOrder?: number
  }): Promise<ModeExample> {
    const now = new Date().toISOString()
    const created: ModeExample = {
      id: uuidv4(),
      modeId: example.modeId,
      spokenInput: example.spokenInput,
      aiOutput: example.aiOutput,
      sortOrder: example.sortOrder ?? 0,
      createdAt: now,
      updatedAt: now,
    }

    await run(
      `INSERT INTO mode_examples (id, mode_id, spoken_input, ai_output, sort_order, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        created.id,
        created.modeId,
        created.spokenInput,
        created.aiOutput,
        created.sortOrder,
        created.createdAt,
        created.updatedAt,
        null,
      ],
    )

    return created
  }

  static async update(
    id: string,
    spokenInput: string,
    aiOutput: string,
  ): Promise<void> {
    await run(
      'UPDATE mode_examples SET spoken_input = ?, ai_output = ?, updated_at = ? WHERE id = ?',
      [spokenInput, aiOutput, new Date().toISOString(), id],
    )
  }

  static async softDelete(id: string): Promise<void> {
    const now = new Date().toISOString()
    await run(
      'UPDATE mode_examples SET deleted_at = ?, updated_at = ? WHERE id = ?',
      [now, now, id],
    )
  }
}
