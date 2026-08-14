import { describe, test, expect } from 'bun:test'
import { MIGRATIONS } from './migrations'

describe('modes schema migrations', () => {
  const ids = MIGRATIONS.map(m => m.id)

  test('both migrations are appended, never inserted before existing ones', () => {
    expect(ids.at(-2)).toBe('20260814190000_add_modes_table')
    expect(ids.at(-1)).toBe('20260814190100_add_mode_examples_table')
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
