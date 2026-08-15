import { describe, test, expect } from 'bun:test'
import { ENCRYPTED_API_KEY_FIELDS } from './store'

describe('API key storage', () => {
  test('every provider key is encrypted at rest, none excepted', () => {
    // La liste est écrite en dur et pas dérivée : un fournisseur ajouté sans y
    // penser laisserait sa clé en clair dans le fichier de réglages, et rien
    // dans l'app ne le dirait. Ce test est le seul endroit qui le remarque.
    expect([...ENCRYPTED_API_KEY_FIELDS]).toEqual([
      'groqApiKey',
      'openRouterApiKey',
      'deepgramApiKey',
      'googleApiKey',
      'openaiApiKey',
    ])
  })
})
