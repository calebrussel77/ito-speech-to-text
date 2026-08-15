import { describe, test, expect } from 'bun:test'
import {
  CATALOG,
  FILE_TRANSCRIPTION_KEYS,
  VOICE_MODELS,
  findModel,
} from './modelCatalog'

describe('modelCatalog', () => {
  test('every key is unique across voice and text models', () => {
    // `findModel` lit une Map construite sur tout le catalogue : deux entrées
    // de même clé n'entrent pas en conflit, la seconde EFFACE la première. Le
    // cas s'est produit — les Gemini audio réutilisaient la clé des Gemini
    // texte servis par OpenRouter, et le sélecteur de fichier résolvait donc
    // un modèle texte, sans que rien ne le signale.
    const keys = CATALOG.map(model => model.key)
    const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index)

    expect(duplicates).toEqual([])
  })

  test('every model resolves to itself through findModel', () => {
    for (const model of CATALOG) {
      expect(findModel(model.key)).toBe(model)
    }
  })

  test('the file transcription models exist and can read a whole file', () => {
    for (const key of FILE_TRANSCRIPTION_KEYS) {
      const model = findModel(key)
      expect(model).toBeDefined()
      expect(model!.kind).toBe('voice')
    }
  })

  test('a file-only model is never offered as a live voice model', () => {
    // Ils lisent un enregistrement complet, ils ne consomment pas un flux :
    // les proposer comme modèle vocal d'un mode ne produirait qu'un échec au
    // moment de parler.
    for (const model of VOICE_MODELS.filter(m => m.fileOnly)) {
      expect(FILE_TRANSCRIPTION_KEYS).toContain(model.key as never)
    }
  })
})
