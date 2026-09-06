import { describe, test, expect } from 'bun:test'
import {
  collapseRepeatedPhrases,
  sanitizeTranscript,
  stripKnownHallucinations,
} from './hallucinationFilter'

describe('hallucinationFilter', () => {
  test('a transcript that is only a known subtitle credit becomes empty', () => {
    expect(
      sanitizeTranscript("Sous-titres réalisés par la communauté d'Amara.org"),
    ).toBe('')
    expect(sanitizeTranscript('Thank you for watching.')).toBe('')
  })

  test("Whisper's French-silence credits are recognised", () => {
    expect(sanitizeTranscript('Sous-titrage Société Radio-Canada')).toBe('')
    expect(sanitizeTranscript("Sous-titrage ST' 501")).toBe('')
    expect(sanitizeTranscript('Sous-titres par Jean Dupont')).toBe('')
    expect(sanitizeTranscript('Merci de votre attention.')).toBe('')
  })

  test('a credit tacked onto real speech is dropped, the speech kept', () => {
    expect(
      stripKnownHallucinations(
        "Il faut déployer jeudi matin. Sous-titres réalisés par la communauté d'Amara.org",
      ),
    ).toBe('Il faut déployer jeudi matin.')
  })

  test('a real sentence that merely contains a trigger phrase is untouched', () => {
    const text = "Merci d'avoir regardé le rapport avant la réunion."
    expect(stripKnownHallucinations(text)).toBe(text)
  })

  test('a phrase looped three times or more is collapsed to one occurrence', () => {
    expect(
      collapseRepeatedPhrases(
        'je pense que oui je pense que oui je pense que oui je pense que oui',
      ),
    ).toBe('je pense que oui')
  })

  test('a phrase repeated twice, or short repeats, are left alone', () => {
    const twice = 'on y va on y va'
    expect(collapseRepeatedPhrases(twice)).toBe(twice)
    const short = 'non non non non non non'
    expect(collapseRepeatedPhrases(short)).toBe(short)
  })

  test('the surrounding text survives a collapse', () => {
    expect(
      collapseRepeatedPhrases(
        'Bon alors, il faut merger la branche il faut merger la branche il faut merger la branche demain.',
      ),
    ).toBe('Bon alors, il faut merger la branche demain.')
  })

  test('empty input stays empty', () => {
    expect(sanitizeTranscript('')).toBe('')
  })
})
