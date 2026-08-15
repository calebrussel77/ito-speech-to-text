import { describe, test, expect } from 'bun:test'
import {
  MODE_PRESETS,
  SEEDED_PRESET_KEYS,
  findPreset,
  type ModePreset,
} from './modePresets'
import { MODE_LANGUAGES } from './modeLanguages'
import { findModel } from './modelCatalog'

describe('modePresets', () => {
  test('ships the six templates, in display order', () => {
    expect(MODE_PRESETS.map(p => p.key)).toEqual([
      'voice-to-text',
      'intelligent',
      'meeting',
      'message',
      'mail',
      'blank',
    ])
  })

  test('Meeting joins the seeded set once its engine exists', () => {
    expect(SEEDED_PRESET_KEYS).toEqual([
      'voice-to-text',
      'intelligent',
      'meeting',
      'message',
      'mail',
      'blank',
    ])
    expect(findPreset('meeting')).toBeDefined()
  })

  test('every preset names a model that exists in the catalogue', () => {
    for (const preset of MODE_PRESETS) {
      if (preset.voiceModelKey) {
        expect(findModel(preset.voiceModelKey)?.kind).toBe('voice')
      }
      if (preset.textModelKey) {
        expect(findModel(preset.textModelKey)?.kind).toBe('text')
      }
    }
  })

  test('voice-to-text is the only preset that skips the LLM', () => {
    const withoutLlm = MODE_PRESETS.filter(p => !p.useLlm).map(p => p.key)
    expect(withoutLlm).toEqual(['voice-to-text'])
  })

  test('every LLM preset carries the three-section instruction structure', () => {
    for (const preset of MODE_PRESETS.filter(
      p => p.useLlm && p.key !== 'blank',
    )) {
      expect(preset.instructions).toContain('## Role')
      expect(preset.instructions).toContain('## Instructions')
      expect(preset.instructions).toContain('## Critical')
    }
  })

  test('blank ships empty instructions — it is the starting point, not a template', () => {
    const blank = MODE_PRESETS.find(p => p.key === 'blank') as ModePreset
    expect(blank.instructions).toBe('')
  })

  test('meeting is the only preset that records the system audio and identifies speakers', () => {
    const system = MODE_PRESETS.filter(p => p.audioSource !== 'microphone')
    expect(system.map(p => p.key)).toEqual(['meeting'])
    // Muting other apps would silence the very meeting being recorded.
    expect(system[0].playbackWhenRecording).toBe('leave')
    expect(system[0].identifySpeakers).toBe(true)
  })

  test('findPreset returns undefined for an unknown key', () => {
    expect(findPreset('voice-to-text')?.label).toBe('Voice to text')
    expect(findPreset('nope')).toBeUndefined()
    expect(findPreset(undefined)).toBeUndefined()
  })
})

describe('modeLanguages', () => {
  test('French first, Automatic last — the hint measurably helps the engine', () => {
    expect(MODE_LANGUAGES.map(l => l.key)).toEqual(['fr', 'en', 'es', 'auto'])
  })

  test('every language carries a flag', () => {
    for (const language of MODE_LANGUAGES) {
      expect(language.flag.length).toBeGreaterThan(0)
    }
  })
})
