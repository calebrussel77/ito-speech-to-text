interface AudioBarsBaseProps {
  heights: number[]
  barColor: string
}

export const BAR_COUNT = 15

export const AudioBarsBase = ({ heights, barColor }: AudioBarsBaseProps) => {
  const barStyle = (height: number, index: number): React.CSSProperties => {
    // Subtle opacity falloff from center to edges for a soft waveform look
    const centerIndex = Math.floor(BAR_COUNT / 2)
    const distanceFromCenter = Math.abs(index - centerIndex)
    const maxDistance = Math.floor(BAR_COUNT / 2)
    const centerFalloff =
      1 - Math.pow(distanceFromCenter / maxDistance, 2) * 0.25

    return {
      width: '2px',
      backgroundColor: barColor,
      borderRadius: '2px',
      height: `${height}px`,
      opacity: centerFalloff,
      transition: 'height 0.09s cubic-bezier(0.25, 0.1, 0.25, 1)',
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        gap: '2px',
        padding: '0 4px',
      }}
    >
      {heights.map((height, i) => (
        <div key={i} style={barStyle(height, i)} />
      ))}
    </div>
  )
}
