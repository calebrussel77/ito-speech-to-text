import { describe, test, expect } from 'bun:test'
import {
  buildDialogueInstruction,
  parseDialogueTranscript,
  speakerLabelWord,
} from './dialogueTranscript'

describe('buildDialogueInstruction', () => {
  test('labels follow the spoken language and the vocabulary is spelled out', () => {
    const fr = buildDialogueInstruction({
      language: 'fr',
      vocabulary: ['Nfluenzo', 'Dokploy'],
    })
    expect(fr).toContain('"Locuteur 1"')
    expect(fr).toContain('Nfluenzo, Dokploy')
    expect(fr).toContain('[HH:MM:SS] Locuteur 1 : ')

    const en = buildDialogueInstruction({ language: 'en' })
    expect(en).toContain('"Speaker 1"')
    expect(en).not.toContain('Spell these names')
    expect(speakerLabelWord('xx')).toBe('Speaker')
  })

  test('lets the model choose: dialogue for several voices, paragraphs for one', () => {
    const text = buildDialogueInstruction({})
    expect(text).toContain('TWO OR MORE speakers')
    expect(text).toContain('only ONE speaker')
    expect(text).toContain('Output nothing but the transcript')
  })
})

describe('parseDialogueTranscript', () => {
  test('a labelled, timestamped dialogue becomes speaker segments', () => {
    const output = [
      '[00:00:03] Locuteur 1 (présentateur) : Bonjour, on commence la démo.',
      '[00:00:10] Locuteur 2 : Oui, allez-y.',
      '[00:01:02] Locuteur 1 : Donc ici on crée une campagne.',
    ].join('\n')

    const parsed = parseDialogueTranscript(output)

    expect(parsed.isConversation).toBe(true)
    expect(parsed.segments.map(s => s.speaker)).toEqual([0, 1, 0])
    // The role given the first time sticks to that voice.
    expect(parsed.segments[2].label).toBe('Locuteur 1 (présentateur)')
    expect(parsed.segments[1].label).toBe('Locuteur 2')
    expect(parsed.segments[0].startMs).toBe(3000)
    expect(parsed.segments[0].endMs).toBe(10000)
    expect(parsed.segments[2].startMs).toBe(62000)
    expect(parsed.text).toBe(
      'Bonjour, on commence la démo. Oui, allez-y. Donc ici on crée une campagne.',
    )
  })

  test('MM:SS timestamps, missing timestamps and wrapped lines are all accepted', () => {
    const output = [
      '[00:03] Speaker 1: Hello there',
      'and this continues the same turn.',
      'Speaker 2: Hi!',
    ].join('\n')

    const parsed = parseDialogueTranscript(output)

    expect(parsed.isConversation).toBe(true)
    expect(parsed.segments).toHaveLength(2)
    expect(parsed.segments[0].text).toBe(
      'Hello there and this continues the same turn.',
    )
    expect(parsed.segments[1].startMs).toBe(3000)
  })

  test('plain paragraphs are returned untouched, with no speakers', () => {
    const output =
      'Note pour moi : penser à relancer le client demain.\n\nEt vérifier les prix : ceux du pack.'

    const parsed = parseDialogueTranscript(output)

    expect(parsed.isConversation).toBe(false)
    expect(parsed.segments).toEqual([])
    expect(parsed.text).toBe(output)
  })

  test('a single labelled voice is not a conversation', () => {
    const parsed = parseDialogueTranscript(
      '[00:00] Locuteur 1 : Mémo du jour.\n[00:20] Locuteur 1 : Suite du mémo.',
    )
    expect(parsed.isConversation).toBe(false)
    expect(parsed.segments).toEqual([])
  })
})
