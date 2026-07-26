import { describe, test, expect } from 'bun:test'
import { applyDictionaryCorrections } from './DictionaryCorrector'

describe('applyDictionaryCorrections', () => {
  test('fixes casing to the canonical spelling', () => {
    expect(
      applyDictionaryCorrections('je pousse sur github ce soir', ['GitHub']),
    ).toBe('je pousse sur GitHub ce soir')
  })

  test('fixes near-miss spellings of technical terms', () => {
    expect(
      applyDictionaryCorrections('le backend utilise guithub actions', [
        'GitHub',
      ]),
    ).toBe('le backend utilise GitHub actions')
    expect(
      applyDictionaryCorrections('je configure tailwinde pour le style', [
        'Tailwind',
      ]),
    ).toBe('je configure Tailwind pour le style')
  })

  test('merges words Whisper split apart', () => {
    expect(
      applyDictionaryCorrections('la carte way finder est à jour', [
        'wayfinder',
      ]),
    ).toBe('la carte wayfinder est à jour')
  })

  test('fixes multi-word terms', () => {
    expect(
      applyDictionaryCorrections('je parle à cloud code dans le terminal', [
        'Claude Code',
      ]),
    ).toBe('je parle à Claude Code dans le terminal')
  })

  test('keeps surrounding punctuation', () => {
    expect(
      applyDictionaryCorrections('Tu connais guithub, non ?', ['GitHub']),
    ).toBe('Tu connais GitHub, non ?')
  })

  test('never rewrites common French words that are not close enough', () => {
    const text = 'le comité se réunit comme prévu'
    expect(applyDictionaryCorrections(text, ['commit'])).toBe(text)
  })

  test('short terms require an exact match', () => {
    expect(applyDictionaryCorrections('le bon vieux temps', ['bun'])).toBe(
      'le bon vieux temps',
    )
    expect(applyDictionaryCorrections('je lance bun run dev', ['bun'])).toBe(
      'je lance bun run dev',
    )
  })

  test('accent differences count as matches', () => {
    expect(applyDictionaryCorrections('déploie sur vercèl', ['Vercel'])).toBe(
      'déploie sur Vercel',
    )
  })

  test('longer dictionary terms win over shorter ones', () => {
    expect(
      applyDictionaryCorrections('ouvre cloud code maintenant', [
        'Claude',
        'Claude Code',
      ]),
    ).toBe('ouvre Claude Code maintenant')
  })

  test('applies replacement pairs (misspelling → wanted spelling)', () => {
    expect(
      applyDictionaryCorrections('je bosse sur Influenso ce soir', [
        { from: 'Influenso', to: 'Nfluenzo' },
      ]),
    ).toBe('je bosse sur Nfluenzo ce soir')
  })

  test('replacement pairs also canonicalize near-misses of the wanted spelling', () => {
    expect(
      applyDictionaryCorrections('le site nfluenzo est en ligne', [
        { from: 'Influenso', to: 'Nfluenzo' },
      ]),
    ).toBe('le site Nfluenzo est en ligne')
  })

  test('does not rewrite the corrected word back to the misspelling', () => {
    expect(
      applyDictionaryCorrections('Nfluenzo grandit vite', [
        { from: 'Influenso', to: 'Nfluenzo' },
      ]),
    ).toBe('Nfluenzo grandit vite')
  })

  test('is a no-op without vocabulary or transcript', () => {
    expect(applyDictionaryCorrections('', ['GitHub'])).toBe('')
    expect(applyDictionaryCorrections('du texte normal', [])).toBe(
      'du texte normal',
    )
  })
})
