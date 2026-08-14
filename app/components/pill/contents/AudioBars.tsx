import { useEffect, useMemo, useState } from 'react'
import { AudioBarsBase, BAR_COUNT } from './AudioBarsBase'

const MIN_HEIGHT = 2
const MAX_HEIGHT = 14

/**
 * Part de hauteur conservée au repos. Sans elle, le silence donne une ligne
 * plate de points de 2px qui se lit comme « cassé » plutôt que « à l'écoute ».
 */
const REST = 0.28

/** Amplitude du battement propre à chaque barre, à plein volume. */
const WOBBLE = 0.24

/** Bruit déterministe : même index → même valeur, à jamais. */
const hash = (seed: number) => Math.abs(Math.sin(seed) * 43758.5453) % 1

/**
 * Profil FIXE de l'égaliseur : une cloche symétrique, plus haute au centre,
 * légèrement irrégulière pour ne pas faire mathématique. Chaque barre garde
 * ce rôle pour toujours — c'est ce qui rend la forme statique.
 */
const PROFILE = Array.from({ length: BAR_COUNT }, (_, i) => {
  const center = (BAR_COUNT - 1) / 2
  const distance = Math.abs(i - center) / center
  const bell = 1 - Math.pow(distance, 1.7) * 0.62
  return bell * (0.82 + hash((i + 1) * 12.9898) * 0.18)
})

/**
 * Fréquence et phase de battement, propres à chaque barre.
 *
 * Volontairement NON linéaires en `index` : c'est un décalage de phase
 * régulier d'une barre à la suivante qui fabrique un front d'onde cohérent,
 * donc l'illusion d'un défilement. Ici, deux barres voisines ne gardent aucun
 * rapport de phase constant — chacune bat à son propre rythme, sur place.
 */
const FREQ = Array.from(
  { length: BAR_COUNT },
  (_, i) => 0.7 + hash((i + 7) * 78.233) * 1.1,
)
const PHASE = Array.from(
  { length: BAR_COUNT },
  (_, i) => hash((i + 3) * 39.425) * Math.PI * 2,
)

/**
 * Égaliseur de dictée. Les barres ne bougent JAMAIS de place : elles réagissent
 * toutes au niveau sonore courant, chacune selon son profil fixe.
 *
 * L'implémentation précédente mappait la barre `i` sur la case
 * `history.length - (BAR_COUNT - i)` de l'historique : à chaque échantillon
 * reçu, toutes les valeurs glissaient d'un cran vers la gauche. D'où le
 * défilement. On ne lit donc plus que le dernier échantillon.
 */
export const AudioBars = ({
  volumeHistory,
  barColor = 'hsl(210, 20%, 96%)',
}: {
  volumeHistory: number[]
  barColor?: string
}) => {
  // Niveau courant, lissé — sans lissage l'égaliseur claque d'un extrême à
  // l'autre à chaque échantillon (80 ms).
  const [level, setLevel] = useState(0)
  // Horloge du battement. Elle n'avance qu'au rythme des échantillons, donc
  // elle s'arrête d'elle-même quand l'enregistrement s'arrête.
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const raw = volumeHistory.length
      ? volumeHistory[volumeHistory.length - 1] || 0
      : 0
    // Courbe exponentielle : réponse plus franche à la parole.
    const target = Math.pow(Math.min(1, raw * 18), 0.8)

    setLevel(previous => previous + (target - previous) * 0.5)
    setTick(previous => previous + 1)
  }, [volumeHistory])

  const heights = useMemo(
    () =>
      PROFILE.map((profile, i) => {
        // Le battement est proportionnel au niveau : en silence, immobile.
        const wobble = 1 + Math.sin(tick * FREQ[i] + PHASE[i]) * WOBBLE * level
        const amplitude = profile * (REST + level * (1 - REST)) * wobble
        const height = MIN_HEIGHT + amplitude * (MAX_HEIGHT - MIN_HEIGHT)
        return Math.min(Math.max(height, MIN_HEIGHT), MAX_HEIGHT)
      }),
    [level, tick],
  )

  return <AudioBarsBase heights={heights} barColor={barColor} />
}

export { PROFILE as BAR_PROFILE, MIN_HEIGHT, MAX_HEIGHT, REST }
