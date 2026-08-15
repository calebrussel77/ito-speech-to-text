import React from 'react'
import {
  BAR_COUNT,
  BAR_WIDTH,
  barsContainerStyle,
  centerFalloff,
} from './AudioBarsBase'
import { BAR_PROFILE, MIN_HEIGHT, MAX_HEIGHT } from './AudioBars'

/**
 * Indicateur de traitement — remplace les trois points.
 *
 * Même instrument que l'égaliseur de dictée (mêmes barres, même profil, même
 * matière), mais un comportement qui ne peut pas être confondu avec de l'audio :
 * une **onde stationnaire** qui gonfle depuis le centre vers les bords, puis
 * retombe. Régulière, mécanique, manifestement pas pilotée par une voix — donc
 * lisible comme « ça travaille » — tout en gardant la famille visuelle des waves.
 *
 * Le déphasage ne dépend que de la DISTANCE au centre, jamais de l'index signé.
 * Les deux moitiés sont donc en miroir : aucun sens de lecture gauche-droite,
 * exactement comme l'égaliseur et le reste de la pill.
 */

const CYCLE_SECONDS = 1.25
/** Avance du centre sur les bords. Plus c'est grand, plus l'onde est ample. */
const SPREAD_SECONDS = 0.42

const CENTER = Math.floor(BAR_COUNT / 2)

const keyframes = `
  @keyframes itoStandingWave {
    0%, 100% {
      transform: scaleY(0.22);
      opacity: 0.4;
    }
    50% {
      transform: scaleY(1);
      opacity: 1;
    }
  }
`

export const ProcessingBars: React.FC<{ color?: string }> = ({
  color = '#FBFAF9',
}) => (
  <>
    <style>{keyframes}</style>
    <div style={barsContainerStyle}>
      {BAR_PROFILE.map((profile, i) => {
        const distance = Math.abs(i - CENTER) / CENTER

        return (
          <div
            key={i}
            style={{
              width: `${BAR_WIDTH}px`,
              flexShrink: 0,
              height: `${MIN_HEIGHT + profile * (MAX_HEIGHT - MIN_HEIGHT)}px`,
              backgroundColor: color,
              borderRadius: `${BAR_WIDTH}px`,
              opacity: centerFalloff(i),
              transformOrigin: 'center',
              // Délai négatif : l'animation démarre déjà avancée. Le centre est
              // le plus avancé (−SPREAD), les bords partent de 0 — l'onde part
              // donc du milieu et se propage vers l'extérieur.
              animation: `itoStandingWave ${CYCLE_SECONDS}s ease-in-out ${
                -(1 - distance) * SPREAD_SECONDS
              }s infinite`,
            }}
          />
        )
      })}
    </div>
  </>
)
