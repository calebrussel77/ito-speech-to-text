interface AudioBarsBaseProps {
  heights: number[]
  barColor: string
}

export const BAR_COUNT = 21

export const AudioBarsBase = ({ heights, barColor }: AudioBarsBaseProps) => {
  const barStyle = (height: number, index: number): React.CSSProperties => {
    // Create a premium center-focused gradient effect
    const centerIndex = Math.floor(BAR_COUNT / 2)
    const distanceFromCenter = Math.abs(index - centerIndex)
    const maxDistance = Math.floor(BAR_COUNT / 2)

    // Smooth opacity falloff from center to edges
    const centerFalloff =
      1 - Math.pow(distanceFromCenter / maxDistance, 1.5) * 0.35

    // Dynamic glow intensity based on bar height
    const glowIntensity = Math.min(height / 20, 1)
    const glowSize = 4 + glowIntensity * 4

    return {
      width: '2.5px',
      backgroundColor: barColor,
      borderRadius: '4px',
      height: `${height}px`,
      opacity: centerFalloff,
      // Smooth, premium height transitions
      transition: 'height 0.06s cubic-bezier(0.25, 0.1, 0.25, 1)',
      // Dynamic glow effect based on height
      boxShadow: `0 0 ${glowSize}px ${barColor}${Math.round(glowIntensity * 50)
        .toString(16)
        .padStart(2, '0')}`,
      // Subtle transform for 3D depth
      transform: `scaleX(${0.9 + centerFalloff * 0.1})`,
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        gap: '1.5px',
        padding: '0 4px',
      }}
    >
      {heights.map((height, i) => (
        <div key={i} style={barStyle(height, i)} />
      ))}
    </div>
  )
}
