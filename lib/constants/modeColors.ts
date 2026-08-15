/**
 * Le code couleur des modes.
 *
 * Chaque mode porte une teinte, et c'est elle — pas une icône — qui le nomme
 * d'un coup d'œil : la pastille d'activation dans la liste des modes, et le
 * point que la pill affiche pendant la dictée.
 *
 * La charte n'autorise la couleur qu'en **pastille de 6 px**, jamais en aplat,
 * jamais sur du texte. Ces valeurs ne servent donc qu'à des points : les barres
 * de la pill restent blanches, les libellés restent blancs. La palette évite
 * l'orange-rouge du vermillon retiré de l'app ; son rouge est plus froid que
 * `--destructive` (#D23855) pour qu'une pastille de mode ne se lise pas comme
 * une alerte — mais c'est un choix de teinte, pas une garantie, et le rouge est
 * offert parce qu'il a été demandé.
 *
 * Les valeurs sont en hexadécimal et non en variables CSS : la fenêtre de la
 * pill ne charge pas `app.css` (cf. renderer.tsx), aucune variable n'y existe.
 * Elles sont écrites sur 6 chiffres pour qu'on puisse leur concaténer une
 * opacité (`${color}33`) partout où un halo est nécessaire.
 */
export const MODE_COLORS = [
  '#6BA6FF', // bleu
  '#E0A44A', // ambre
  '#B18AF5', // violet
  '#52C98B', // vert
  '#EC7FB0', // rose
  '#3FC7C2', // turquoise
  '#A9C64E', // citron
  '#4FB6E8', // ciel
  '#E05260', // rouge
  '#8E8C88', // gris
] as const

/**
 * Empreinte stable d'un identifiant de mode.
 *
 * Le point de départ de la teinte dépend de l'id seul, jamais du rang dans la
 * liste : supprimer un mode ne redistribue donc pas les couleurs des autres,
 * ce qu'un simple `index % palette.length` aurait fait à chaque suppression.
 */
function hashModeId(id: string): number {
  let hash = 0
  for (let index = 0; index < id.length; index += 1) {
    hash = (Math.imul(hash, 31) + id.charCodeAt(index)) >>> 0
  }
  return hash
}

/** Ce qu'il faut d'un mode pour lui attribuer une couleur. */
export interface ModeColorInput {
  id: string
  /** Teinte choisie par l'utilisateur, ou `null`/absente pour « dérivée ». */
  color?: string | null
}

/**
 * Attribue une couleur à chaque mode, dans l'ordre d'affichage.
 *
 * Une teinte choisie l'emporte toujours, sans discussion : elle est rendue
 * telle quelle, et si deux modes portent la même, c'est que l'utilisateur l'a
 * voulu. Les autres sont dérivées de l'empreinte de leur id.
 *
 * Deux modes dérivés peuvent tomber sur la même empreinte ; le second glisse
 * alors sur la teinte libre suivante. Les couleurs déjà choisies comptent comme
 * prises, pour qu'un mode dérivé n'aille pas se poser sur l'une d'elles tant
 * qu'il reste de la place ailleurs. Tant qu'il y a moins de modes que de
 * couleurs, deux modes ne partagent donc jamais la leur — c'est ce qui permet
 * de lire un mode à sa couleur. Au-delà, les teintes se répètent, faute de mieux.
 */
export function assignModeColors(
  modes: ModeColorInput[],
): Record<string, string> {
  const taken = new Set<number>()
  const colors: Record<string, string> = {}

  for (const mode of modes) {
    if (!mode.color) continue
    colors[mode.id] = mode.color
    const slot = MODE_COLORS.indexOf(mode.color as (typeof MODE_COLORS)[number])
    if (slot !== -1) taken.add(slot)
  }

  for (const mode of modes) {
    if (colors[mode.id]) continue
    const start = hashModeId(mode.id) % MODE_COLORS.length
    let slot = start
    for (let step = 0; step < MODE_COLORS.length; step += 1) {
      const candidate = (start + step) % MODE_COLORS.length
      if (!taken.has(candidate)) {
        slot = candidate
        break
      }
    }
    taken.add(slot)
    colors[mode.id] = MODE_COLORS[slot]!
  }

  return colors
}

/**
 * La couleur d'un mode. `modes` est la liste affichée, qui sert à écarter les
 * collisions ; un id absent de cette liste garde sa teinte d'empreinte plutôt
 * que de n'en avoir aucune.
 */
export function modeColor(
  modeId: string | null | undefined,
  modes: ModeColorInput[],
): string | null {
  if (!modeId) return null
  return (
    assignModeColors(modes)[modeId] ??
    MODE_COLORS[hashModeId(modeId) % MODE_COLORS.length]!
  )
}
