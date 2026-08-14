import { AudioBarsBase } from './AudioBarsBase'
import { BAR_PROFILE, MIN_HEIGHT, MAX_HEIGHT, REST } from './AudioBars'

/**
 * Aperçu au survol : la silhouette réelle de l'égaliseur, figée à un niveau
 * intermédiaire pour donner un avant-goût de ce que la dictée affichera.
 *
 * Elle était codée en dur dans un tableau de 15 valeurs, et avait donc dérivé
 * de la forme effective : le survol ne préfigurait plus rien.
 */
const PREVIEW_LEVEL = 0.45

const PREVIEW_HEIGHTS = BAR_PROFILE.map(profile => {
  const amplitude = profile * (REST + PREVIEW_LEVEL * (1 - REST))
  return MIN_HEIGHT + amplitude * (MAX_HEIGHT - MIN_HEIGHT)
})

export const PreviewAudioBars = () => (
  <AudioBarsBase
    heights={PREVIEW_HEIGHTS}
    barColor="hsla(210, 20%, 96%, 0.6)"
  />
)
