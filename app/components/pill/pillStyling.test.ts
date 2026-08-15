import { describe, test, expect } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * La fenêtre de la pill ne charge pas `app.css` (cf. renderer.tsx) : aucune
 * classe utilitaire Tailwind n'y est définie. Une classe écrite ici ne fait
 * donc rien du tout — c'est ainsi que le nom du mode s'est retrouvé affiché en
 * noir, à la taille par défaut du navigateur, sur un fond near-black.
 *
 * Ce garde-fou lit le source plutôt que le rendu parce que le défaut est
 * invisible à l'exécution : sans feuille de style, une classe morte ne lève
 * rien, ne casse aucun test, et ne se voit qu'à l'œil sur l'écran.
 *
 * Seule exception tolérée : `border-none` sur un `TooltipContent`, dont le
 * composant partagé applique de toute façon ses propres classes — inertes ici,
 * et neutralisées par les styles inline que la pill lui passe.
 */
const ALLOWED_CLASS_NAMES = new Set(['border-none'])

const PILL_DIR = join(import.meta.dir)

function pillSourceFiles(): string[] {
  return readdirSync(PILL_DIR, { recursive: true, encoding: 'utf-8' })
    .filter(entry => entry.endsWith('.tsx'))
    .map(entry => join(PILL_DIR, entry))
}

describe('pill styling', () => {
  test('the pill window styles itself inline, never with Tailwind classes', () => {
    const offenders: string[] = []

    for (const file of pillSourceFiles()) {
      const source = readFileSync(file, 'utf-8')
      for (const match of source.matchAll(
        /className=(?:"([^"]*)"|\{([^}]*)\})/g,
      )) {
        const value = (match[1] ?? match[2] ?? '').trim()
        if (!ALLOWED_CLASS_NAMES.has(value)) {
          offenders.push(`${file}: ${value}`)
        }
      }
    }

    expect(offenders).toEqual([])
  })

  test('the scan actually reads the pill sources', () => {
    // Sans ce filet, un chemin cassé rendrait le test ci-dessus vert en ne
    // lisant rien du tout — la forme de couverture sans le contenu.
    const files = pillSourceFiles()
    expect(files.length).toBeGreaterThanOrEqual(6)
    expect(files.some(file => file.endsWith('Pill.tsx'))).toBe(true)
  })
})
