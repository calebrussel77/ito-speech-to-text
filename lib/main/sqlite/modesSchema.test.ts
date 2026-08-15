import { describe, test, expect } from 'bun:test'
import { MIGRATIONS } from './migrations'

describe('modes schema migrations', () => {
  const ids = MIGRATIONS.map(m => m.id)

  test('the modes migrations are appended, never inserted before existing ones', () => {
    expect(ids.slice(-4)).toEqual([
      '20260814190000_add_modes_table',
      '20260814190100_add_mode_examples_table',
      '20260815120000_add_color_to_modes',
      '20260815140000_default_voice_model_to_whisper_v3',
    ])
  })

  test('migration ids are unique', () => {
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('the modes table carries every column the repository writes', () => {
    const up = MIGRATIONS.find(
      m => m.id === '20260814190000_add_modes_table',
    )!.up
    for (const column of [
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
      'created_at',
      'updated_at',
      'deleted_at',
    ]) {
      expect(up).toContain(column)
    }
  })

  test('the colour column arrives by ALTER, never by editing the create', () => {
    // Une base déjà créée ne rejoue pas `CREATE TABLE` : ajouter la colonne
    // dans la migration d'origine la donnerait aux installations neuves et à
    // personne d'autre. Ce test échoue si quelqu'un « corrige » ça un jour.
    const create = MIGRATIONS.find(
      m => m.id === '20260814190000_add_modes_table',
    )!.up
    expect(create).not.toContain('color')

    const alter = MIGRATIONS.find(
      m => m.id === '20260815120000_add_color_to_modes',
    )!.up
    expect(alter).toContain('ALTER TABLE modes ADD COLUMN color')
  })

  test('examples cascade with their mode', () => {
    const up = MIGRATIONS.find(
      m => m.id === '20260814190100_add_mode_examples_table',
    )!.up
    expect(up).toContain('REFERENCES modes (id) ON DELETE CASCADE')
  })

  test('every migration is reversible', () => {
    for (const migration of MIGRATIONS) {
      expect(migration.down.length).toBeGreaterThan(0)
    }
  })
})
