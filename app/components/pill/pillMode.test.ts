import { describe, test, expect } from 'bun:test'
import { pillMode, type PillModeState } from './pillMode'

const VOICE = { id: 'voice-to-text', icon: 'Microphone', color: '#6BA6FF' }
const ACTIVE = { id: 'intelligent', icon: 'Sparkles' }

/** Ce que la pill sait quand rien n'a encore été dicté depuis son ouverture. */
const NOTHING_BROADCAST = { id: '', icon: '', color: '' }

const state = (overrides: Partial<PillModeState> = {}): PillModeState => ({
  recording: false,
  processing: false,
  broadcast: NOTHING_BROADCAST,
  active: ACTIVE,
  ...overrides,
})

describe('pillMode', () => {
  test('at rest, the pill shows the active mode', () => {
    expect(pillMode(state())).toEqual({
      id: 'intelligent',
      icon: 'Sparkles',
      color: null,
    })
  })

  test('while recording, it shows the mode that started the dictation', () => {
    const shown = pillMode(state({ recording: true, broadcast: VOICE }))

    expect(shown.id).toBe('voice-to-text')
    expect(shown.icon).toBe('Microphone')
    expect(shown.color).toBe('#6BA6FF')
  })

  test('while processing, it still shows that mode — not the active one', () => {
    // La régression : l'arrêt de l'enregistrement et le début du traitement
    // sont deux diffusions distinctes. Entre les deux, `recording` est déjà
    // faux ; si le mode qui dicte était oublié là, la transcription s'affichait
    // sous l'icône et la couleur du mode actif.
    const shown = pillMode({
      recording: false,
      processing: true,
      broadcast: VOICE,
      active: ACTIVE,
    })

    expect(shown.id).toBe('voice-to-text')
    expect(shown.icon).toBe('Microphone')
    expect(shown.color).toBe('#6BA6FF')
  })

  test('once the processing ends, it returns to the active mode', () => {
    // La diffusion n'est jamais effacée — elle n'est plus lue, c'est tout.
    // Une dictée annulée (arrêtée sans traitement) passe par ici aussi.
    const shown = pillMode(state({ broadcast: VOICE }))

    expect(shown.id).toBe('intelligent')
    expect(shown.icon).toBe('Sparkles')
    expect(shown.color).toBeNull()
  })

  test('a dictating mode with no chosen colour leaves the tint to be derived', () => {
    const shown = pillMode(
      state({ recording: true, broadcast: { ...VOICE, color: '' } }),
    )

    expect(shown.id).toBe('voice-to-text')
    expect(shown.color).toBeNull()
  })

  test('a broadcast that named no mode falls back to the active one', () => {
    const shown = pillMode(state({ recording: true }))

    expect(shown.id).toBe('intelligent')
    expect(shown.icon).toBe('Sparkles')
  })

  test('with no active mode and nothing dictating, there is nothing to show', () => {
    expect(pillMode(state({ active: {} }))).toEqual({
      id: undefined,
      icon: null,
      color: null,
    })
  })
})
