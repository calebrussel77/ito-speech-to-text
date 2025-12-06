import { AudioBarsBase } from './AudioBarsBase'

// Premium preview heights - create a smooth wave pattern for idle state
export const PreviewAudioBars = () => {
  // Create a smooth sine-wave inspired pattern for elegant preview
  const staticHeights = [
    3, 5, 7, 9, 11, 13, 14, 13, 11, 9, 12, 15, 12, 10, 12, 14, 12, 9, 7, 5, 3,
  ]

  // Use a subtle off-white for the preview to differentiate from active recording
  return <AudioBarsBase heights={staticHeights} barColor="hsla(210, 20%, 96%, 0.7)" />
}
