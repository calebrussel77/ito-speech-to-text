export interface AudioPreparationResult {
  wavAudio: Buffer
  sampleRate: number
  durationMs: number
}

type PrepareOptions = {
  sampleRate?: number
  channels?: number
  bitDepth?: number
  enhance?: boolean
  maxBytes?: number
}

/**
 * Lightweight audio utilities used entirely on the client.
 * Ports the server-side helpers so the renderer can call Groq directly.
 */
export class LocalAudioProcessor {
  private readonly defaultSampleRate = 16000
  private readonly defaultChannels = 1
  private readonly defaultBitDepth = 16
  private readonly minDurationMs = 100
  private readonly groqMaxBytes = 25 * 1024 * 1024 // 25 MB

  concatenateAudioChunks(chunks: Buffer[]): Buffer {
    if (!chunks.length) return Buffer.alloc(0)
    return Buffer.concat(chunks)
  }

  createWavHeader(
    dataLength: number,
    sampleRate: number,
    channelCount: number,
    bitDepth: number,
  ): Buffer {
    const header = Buffer.alloc(44)

    header.write('RIFF', 0)
    header.writeUInt32LE(36 + dataLength, 4)
    header.write('WAVE', 8)

    header.write('fmt ', 12)
    header.writeUInt32LE(16, 16)
    header.writeUInt16LE(1, 20)
    header.writeUInt16LE(channelCount, 22)
    header.writeUInt32LE(sampleRate, 24)

    const blockAlign = channelCount * (bitDepth / 8)
    const byteRate = sampleRate * blockAlign

    header.writeUInt32LE(byteRate, 28)
    header.writeUInt16LE(blockAlign, 32)
    header.writeUInt16LE(bitDepth, 34)

    header.write('data', 36)
    header.writeUInt32LE(dataLength, 40)

    return header
  }

  enhancePcm16(pcm: Buffer, sampleRate: number): Buffer {
    if (!pcm || pcm.length < 2) return pcm

    const sampleCount = Math.floor(pcm.length / 2)
    if (sampleCount <= 0) return pcm

    const samples = new Int16Array(sampleCount)
    for (let i = 0; i < sampleCount; i++) {
      samples[i] = pcm.readInt16LE(i * 2)
    }

    let sum = 0
    for (let i = 0; i < sampleCount; i++) sum += samples[i]
    const mean = Math.trunc(sum / sampleCount)
    if (mean !== 0) {
      for (let i = 0; i < sampleCount; i++) {
        samples[i] = (samples[i] - mean) as Int16Array[number]
      }
    }

    const fc = 80
    const a = Math.exp((-2 * Math.PI * fc) / sampleRate)
    let prevX = 0
    let prevY = 0
    const filtered = new Float32Array(sampleCount)
    for (let i = 0; i < sampleCount; i++) {
      const x = samples[i]
      const y = a * (prevY + x - prevX)
      filtered[i] = y
      prevX = x
      prevY = y
    }

    let peak = 1
    for (let i = 0; i < sampleCount; i++) {
      const v = Math.abs(filtered[i])
      if (v > peak) peak = v
    }
    const target = 0.707 * 32767
    const rawGain = target / peak
    const gain = Math.min(rawGain, 4.0)

    const out = Buffer.alloc(sampleCount * 2)
    if (gain > 1.05) {
      for (let i = 0; i < sampleCount; i++) {
        const v = Math.round(filtered[i] * gain)
        const clamped = Math.max(-32768, Math.min(32767, v))
        out.writeInt16LE(clamped, i * 2)
      }
    } else {
      for (let i = 0; i < sampleCount; i++) {
        const v = Math.round(filtered[i])
        const clamped = Math.max(-32768, Math.min(32767, v))
        out.writeInt16LE(clamped, i * 2)
      }
    }

    return out
  }

  /**
   * Validates and converts raw PCM to a WAV buffer suitable for Groq.
   * Returns both the WAV buffer and calculated metadata.
   */
  prepareAudioForTranscription(
    audioPcm: Buffer,
    options: PrepareOptions = {},
  ): AudioPreparationResult {
    const sampleRate = options.sampleRate || this.defaultSampleRate
    const channels = options.channels || this.defaultChannels
    const bitDepth = options.bitDepth || this.defaultBitDepth
    const maxBytes = options.maxBytes || this.groqMaxBytes

    if (!audioPcm || audioPcm.length === 0) {
      throw new Error('No audio data provided')
    }

    if (audioPcm.length > maxBytes) {
      throw new Error('Audio exceeds Groq 25MB limit')
    }

    const bytesPerSample = bitDepth / 8
    const totalSamples = audioPcm.length / bytesPerSample
    const durationMs = Math.floor((totalSamples / sampleRate) * 1000)

    if (durationMs < this.minDurationMs) {
      throw new Error('Audio too short to transcribe')
    }

    const enhanced = options.enhance ?? true
    const processed = enhanced
      ? this.enhancePcm16(audioPcm, sampleRate)
      : audioPcm

    const header = this.createWavHeader(
      processed.length,
      sampleRate,
      channels,
      bitDepth,
    )

    return {
      wavAudio: Buffer.concat([header, processed]),
      sampleRate,
      durationMs,
    }
  }
}

export const localAudioProcessor = new LocalAudioProcessor()
