import { describe, test, expect } from 'bun:test'
import { stripReasoning } from './reasoning'

describe('stripReasoning', () => {
  test('removes an inline think block and keeps only the answer', () => {
    // La forme exacte de la fuite constatée le 2026-08-15 : qwen3.7-flash via
    // OpenRouter collait son monologue interne dans `content`, et la dictée
    // insérait quatre pages de raisonnement avant la phrase corrigée.
    const leaked = `<think>\n\nHere's a thinking process:\n\n1. Analyze User Input...\n   Output matches exactly.\n\n</think>\n\nOk, Claude, super. Maintenant, fais un commit.`

    expect(stripReasoning(leaked)).toBe(
      'Ok, Claude, super. Maintenant, fais un commit.',
    )
  })

  test('leaves a clean answer untouched', () => {
    expect(stripReasoning('Bonjour, voici le texte corrigé.')).toBe(
      'Bonjour, voici le texte corrigé.',
    )
  })

  test('an unclosed think block leaves nothing — there is no answer inside', () => {
    // Pensée tronquée par max_tokens : la réponse n'a jamais été produite.
    // Rendre '' fait retomber TranscriptAdjuster sur le transcript brut,
    // plutôt que de dicter un raisonnement coupé au milieu.
    expect(stripReasoning('<think>\nSome unfinished reasoning...')).toBe('')
  })

  test('also handles the <thinking> spelling and multiple blocks', () => {
    expect(
      stripReasoning(
        '<thinking>a</thinking>Première phrase.<think>b</think> Deuxième.',
      ),
    ).toBe('Première phrase. Deuxième.')
  })

  test('a think tag mid-text does not swallow what came before it', () => {
    expect(stripReasoning('Réponse utile. <think>appendix...')).toBe(
      'Réponse utile.',
    )
  })
})
