import { describe, test, expect } from 'bun:test'
import { CATALOG } from '@/lib/constants/modelCatalog'
import { MODEL_LAB_ICONS, PROVIDER_ICONS } from './modelLabIcons'

/**
 * Un fournisseur ou un laboratoire sans logo ne dégrade pas l'affichage : il
 * rend `<undefined />`, React lève « Element type is invalid », et tout
 * l'écran devient noir. C'est arrivé à l'ajout de Google — le typage ne
 * l'attrape pas, l'indexation d'un Record par une union trop large passe en
 * `any` implicite.
 */
describe('model icon coverage', () => {
  test('every catalog lab has an icon', () => {
    for (const model of CATALOG) {
      expect(MODEL_LAB_ICONS[model.lab]).toBeDefined()
    }
  })

  test('every catalog provider and pinned provider has an icon', () => {
    for (const model of CATALOG) {
      expect(PROVIDER_ICONS[model.provider]).toBeDefined()
      if (model.pinnedProvider) {
        expect(PROVIDER_ICONS[model.pinnedProvider]).toBeDefined()
      }
    }
  })
})
