import { audioRecorderService } from '../../media/audio'

export class AudioStreamManager {
  private isStreaming = false
  private audioChunks: Buffer[] = []
  private currentSampleRate: number = 16000

  initialize() {
    this.isStreaming = true
    this.audioChunks = []
    this.setupListeners()
  }

  stopStreaming() {
    this.isStreaming = false
    this.removeListeners()
  }

  private setupListeners() {
    console.log('[AudioStreamManager] Setting up audio listeners')
    audioRecorderService.on('audio-chunk', this.handleAudioChunk)
    audioRecorderService.on('audio-config', this.handleAudioConfig)
  }

  private removeListeners() {
    console.log('[AudioStreamManager] Removing audio listeners')
    audioRecorderService.off('audio-chunk', this.handleAudioChunk)
    audioRecorderService.off('audio-config', this.handleAudioConfig)
  }

  private handleAudioChunk = (chunk: Buffer) => {
    this.addAudioChunk(chunk)
  }

  private handleAudioConfig = ({ outputSampleRate, sampleRate }: any) => {
    const effectiveRate = outputSampleRate || sampleRate || 16000
    console.log('[AudioStreamManager] Received audio config:', {
      outputSampleRate,
      sampleRate,
      effectiveRate,
    })
    this.setAudioConfig({ sampleRate: effectiveRate })
  }

  addAudioChunk(chunk: Buffer) {
    if (!this.isStreaming) {
      return
    }
    this.audioChunks.push(chunk)
  }

  /**
   * Returns all buffered audio for the current interaction.
   */
  getAllAudio(): Buffer {
    return Buffer.concat(this.audioChunks)
  }

  // Backwards compatibility for legacy tests
  async *streamAudioChunks() {
    if (this.audioChunks.length === 0) return
    for (const chunk of this.audioChunks) {
      yield { audioData: chunk } as any
    }
  }

  getInteractionAudioBuffer(): Buffer {
    return this.getAllAudio()
  }

  setAudioConfig(config: { sampleRate?: number; channels?: number }) {
    if (typeof config.sampleRate === 'number' && config.sampleRate > 0) {
      this.currentSampleRate = config.sampleRate
    }
  }

  getCurrentSampleRate(): number {
    return this.currentSampleRate
  }

  isCurrentlyStreaming(): boolean {
    return this.isStreaming
  }

  clearInteractionAudio() {
    this.audioChunks = []
  }

  getAudioDurationMs(): number {
    const totalBytes = this.audioChunks.reduce(
      (sum, chunk) => sum + chunk.length,
      0,
    )
    const bytesPerSample = 2 // 16-bit PCM mono
    const totalSamples = totalBytes / bytesPerSample
    const durationSeconds = totalSamples / this.currentSampleRate
    return Math.floor(durationSeconds * 1000)
  }
}
