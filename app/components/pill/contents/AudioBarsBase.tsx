interface AudioBarsBaseProps {
  heights: number[]
  barColor: string
}

export const BAR_COUNT = 15
export const BAR_WIDTH = 2
export const BAR_GAP = 2

/**
 * Atténuation d'opacité du centre vers les bords. Partagée avec l'indicateur
 * de traitement pour que les deux états aient exactement la même matière.
 */
export const centerFalloff = (index: number): number => {
  const centerIndex = Math.floor(BAR_COUNT / 2)
  const distanceFromCenter = Math.abs(index - centerIndex)
  const maxDistance = Math.floor(BAR_COUNT / 2)
  return 1 - Math.pow(distanceFromCenter / maxDistance, 2) * 0.25
}

export const barsContainerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
  gap: `${BAR_GAP}px`,
  padding: '0 4px',
}

export const AudioBarsBase = ({ heights, barColor }: AudioBarsBaseProps) => {
  const barStyle = (height: number, index: number): React.CSSProperties => ({
    width: `${BAR_WIDTH}px`,
    backgroundColor: barColor,
    borderRadius: `${BAR_WIDTH}px`,
    height: `${height}px`,
    opacity: centerFalloff(index),
    transition: 'height 0.09s cubic-bezier(0.25, 0.1, 0.25, 1)',
  })

  return (
    <div style={barsContainerStyle}>
      {heights.map((height, i) => (
        <div key={i} style={barStyle(height, i)} />
      ))}
    </div>
  )
}
