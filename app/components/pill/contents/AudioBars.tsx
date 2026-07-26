import { useEffect, useState, useMemo } from 'react'
import { AudioBarsBase, BAR_COUNT } from './AudioBarsBase'

const MIN_HEIGHT = 2
const MAX_HEIGHT = 14

// Live waveform: newest volume samples flow in from the right and scroll left.
// When the user is silent, bars settle into a gentle idle ripple.
export const AudioBars = ({
  volumeHistory,
  barColor = 'hsl(210, 20%, 96%)',
}: {
  volumeHistory: number[]
  barColor?: string
}) => {
  const [phase, setPhase] = useState(0)

  useEffect(() => {
    setPhase(prev => prev + 1)
  }, [volumeHistory])

  const dynamicHeights = useMemo(() => {
    return Array(BAR_COUNT)
      .fill(0)
      .map((_, index) => {
        // Map each bar to a slot in the volume history (newest on the right)
        const historyIndex = volumeHistory.length - (BAR_COUNT - index)
        const volume = historyIndex >= 0 ? volumeHistory[historyIndex] || 0 : 0

        // Exponential curve for a punchier response to speech
        const normalizedVolume = Math.min(1, volume * 18)
        const scale = Math.pow(normalizedVolume, 0.8)

        // Gentle idle ripple so the waveform feels alive during silence
        const idleRipple = (Math.sin(phase * 0.55 + index * 0.85) + 1) * 0.75

        const height =
          MIN_HEIGHT + idleRipple + scale * (MAX_HEIGHT - MIN_HEIGHT)
        return Math.min(Math.max(height, MIN_HEIGHT), MAX_HEIGHT)
      })
  }, [volumeHistory, phase])

  return <AudioBarsBase heights={dynamicHeights} barColor={barColor} />
}
