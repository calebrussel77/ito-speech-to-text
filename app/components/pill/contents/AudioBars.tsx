import { useEffect, useState, useMemo } from 'react'
import { AudioBarsBase, BAR_COUNT } from './AudioBarsBase'

// Premium audio visualization component with smooth animations
export const AudioBars = ({
  volumeHistory,
  barColor = 'hsl(210, 20%, 96%)',
}: {
  volumeHistory: number[]
  barColor?: string
}) => {
  const [activeBarIndex, setActiveBarIndex] = useState(0)

  useEffect(() => {
    setActiveBarIndex(prevIndex => (prevIndex + 1) % BAR_COUNT)
  }, [volumeHistory])

  // Calculate dynamic heights with smooth wave-like interpolation
  const dynamicHeights = useMemo(() => {
    return Array(BAR_COUNT)
      .fill(1)
      .map((_, index) => {
        // Get volume from history with mirrored effect from center
        const centerIndex = Math.floor(BAR_COUNT / 2)
        const distanceFromCenter = Math.abs(index - centerIndex)
        const historyIndex = volumeHistory.length - distanceFromCenter - 1

        const volume = volumeHistory[Math.max(0, historyIndex)] || 0

        // Smooth scaling with exponential curve for more dynamic response
        const normalizedVolume = Math.max(0.03, Math.min(1, volume * 18))
        const scale = Math.pow(normalizedVolume, 0.85)

        // Add subtle wave motion based on position
        const waveOffset = Math.sin((index / BAR_COUNT) * Math.PI) * 0.3
        const activeBoost = index === activeBarIndex ? 1.15 : 1

        // Calculate final height with minimum visibility
        const baseHeight = 2
        const maxHeight = 20
        const height =
          (baseHeight + scale * (maxHeight - baseHeight) + waveOffset) *
          activeBoost

        return Math.min(Math.max(height, 2), maxHeight)
      })
  }, [volumeHistory, activeBarIndex])

  return <AudioBarsBase heights={dynamicHeights} barColor={barColor} />
}
