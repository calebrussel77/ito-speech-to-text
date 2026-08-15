import { describe, test, expect } from 'bun:test'
import { MODE_COLORS, assignModeColors, modeColor } from './modeColors'

/** Un mode sans teinte choisie : sa couleur est dérivée de son id. */
const derived = (...ids: string[]) => ids.map(id => ({ id }))

describe('modeColors', () => {
  test('the palette holds ten distinct six-digit hexadecimal values', () => {
    expect(MODE_COLORS).toHaveLength(10)
    expect(new Set(MODE_COLORS).size).toBe(10)
    for (const color of MODE_COLORS) {
      expect(color).toMatch(/^#[0-9A-F]{6}$/)
    }
  })

  test('a list no longer than the palette never repeats a colour', () => {
    // Trois groupes d'ids visent ici la même empreinte — `charlie`/`delta`/
    // `mike`, `foxtrot`/`golf`/`november`, `alpha`/`bravo` : c'est justement le
    // cas que l'écartement des collisions doit traiter, et qu'une liste d'ids
    // bien répartis n'aurait pas éprouvé.
    const modes = derived(
      'charlie',
      'delta',
      'mike',
      'foxtrot',
      'golf',
      'november',
      'alpha',
      'bravo',
      'hotel',
      'kilo',
    )
    const colors = assignModeColors(modes)
    expect(new Set(Object.values(colors)).size).toBe(modes.length)
  })

  test('deleting a mode leaves the colours of the undisplaced ones untouched', () => {
    // `hotel`, `kilo`, `echo` et `lima` tombent sur quatre empreintes
    // distinctes : aucun n'est déplacé, donc aucun ne bouge quand un autre
    // disparaît. C'est la propriété que l'empreinte achète, et qu'un
    // `index % palette.length` n'aurait pas eue.
    const before = assignModeColors(derived('hotel', 'kilo', 'echo', 'lima'))
    const after = assignModeColors(derived('hotel', 'echo', 'lima'))

    expect(after['hotel']).toBe(before['hotel']!)
    expect(after['echo']).toBe(before['echo']!)
    expect(after['lima']).toBe(before['lima']!)
  })

  test('a mode displaced by a collision returns to its own teint once freed', () => {
    // `charlie` et `delta` visent la même teinte : le second glisse. C'est la
    // contrepartie assumée de l'unicité — si le premier disparaît, le second
    // retrouve la sienne. Seul un mode déplacé peut changer de couleur.
    const together = assignModeColors(derived('charlie', 'delta'))
    expect(together['charlie']).not.toBe(together['delta']!)

    const alone = assignModeColors(derived('delta'))
    expect(alone['delta']).toBe(together['charlie']!)
  })

  test('an id outside the list still resolves to a colour', () => {
    expect(modeColor('orphan', [])).toBe(
      modeColor('orphan', derived('orphan'))!,
    )
  })

  test('no mode means no colour, rather than a default one', () => {
    expect(modeColor(null, derived('alpha'))).toBeNull()
    expect(modeColor(undefined, derived('alpha'))).toBeNull()
    expect(modeColor('', derived('alpha'))).toBeNull()
  })

  test('more modes than colours reuses teints instead of running out', () => {
    const modes = derived(
      ...Array.from({ length: 14 }, (_, index) => `mode-${index}`),
    )
    const colors = assignModeColors(modes)

    expect(Object.keys(colors)).toHaveLength(14)
    for (const color of Object.values(colors)) {
      expect(MODE_COLORS).toContain(color as (typeof MODE_COLORS)[number])
    }
  })

  test('a chosen colour is served as chosen, palette or not', () => {
    const colors = assignModeColors([
      { id: 'alpha', color: '#123456' },
      { id: 'bravo', color: MODE_COLORS[3]! },
      { id: 'charlie', color: null },
    ])

    expect(colors['alpha']).toBe('#123456')
    expect(colors['bravo']).toBe(MODE_COLORS[3]!)
    expect(colors['charlie']).toBeDefined()
  })

  test('a derived mode steps aside from a colour someone else has chosen', () => {
    // `delta` dérive sur sa teinte d'empreinte. Si un autre mode
    // l'a explicitement choisie, `charlie` doit s'en écarter : sans ça, un
    // choix de l'utilisateur se retrouve dupliqué sans qu'il l'ait demandé.
    const claimed = assignModeColors(derived('delta'))['delta']!

    const colors = assignModeColors([
      { id: 'zulu', color: claimed },
      { id: 'delta' },
    ])

    expect(colors['zulu']).toBe(claimed)
    expect(colors['delta']).not.toBe(claimed)
  })

  test('two modes may share a colour, but only because both were chosen', () => {
    const colors = assignModeColors([
      { id: 'alpha', color: MODE_COLORS[0]! },
      { id: 'bravo', color: MODE_COLORS[0]! },
    ])

    expect(colors['alpha']).toBe(MODE_COLORS[0]!)
    expect(colors['bravo']).toBe(MODE_COLORS[0]!)
  })
})
