import { AudioBarsBase } from './AudioBarsBase'

// Static wave pattern shown on hover — a quiet hint of the live waveform
export const PreviewAudioBars = () => {
  const staticHeights = [2, 3, 4, 6, 8, 10, 11, 10, 8, 10, 8, 6, 4, 3, 2]

  // Use a subtle off-white for the preview to differentiate from active recording
  return (
    <AudioBarsBase
      heights={staticHeights}
      barColor="hsla(210, 20%, 96%, 0.6)"
    />
  )
}
