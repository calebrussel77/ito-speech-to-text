import { audioRecorderService } from '../../media/audio'

export class AudioStreamManager {
  private isStreaming = false
  private audioChunks: Buffer[] = []
  private currentSampleRate: number = 16000
  private chunkWaiters: Array<() => void> = []
  private chunkListeners: Array<(chunk: Buffer) => void> = []

  /** Reçoit chaque bloc PCM au moment où il arrive (encodage au fil de l'eau). */
  onChunk(listener: (chunk: Buffer) => void): () => void {
    this.chunkListeners.push(listener)
    return () => {
      this.chunkListeners = this.chunkListeners.filter(l => l !== listener)
    }
  }

  private notifyChunkWaiters() {
    const waiters = this.chunkWaiters
    this.chunkWaiters = []
    for (const resolve of waiters) resolve()
  }

  initialize() {
    this.isStreaming = true
    this.audioChunks = []
    this.notifyChunkWaiters()
    this.setupListeners()
  }

  stopStreaming() {
    this.isStreaming = false
    this.removeListeners()
    this.notifyChunkWaiters()
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
    for (const listener of this.chunkListeners) listener(chunk)
    this.notifyChunkWaiters()
  }

  /**
   * Returns all buffered audio for the current interaction.
   */
  getAllAudio(): Buffer {
    return Buffer.concat(this.audioChunks)
  }

  async *streamAudioChunks() {
    let cursor = 0
    while (true) {
      while (cursor < this.audioChunks.length) {
        const chunk = this.audioChunks[cursor]
        cursor += 1
        yield { audioData: chunk } as any
      }

      if (!this.isStreaming) {
        return
      }

      await new Promise<void>(resolve => {
        this.chunkWaiters.push(resolve)
      })
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
    this.notifyChunkWaiters()
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
