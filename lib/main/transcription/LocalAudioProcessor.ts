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
  /**
   * Plafond de sécurité, pas une limite de transport : c'est le routeur qui
   * sait quel transport supporte quoi. Une heure d'audio 16 kHz mono pèse
   * ~115 Mo ; au-delà de 512 Mo on est face à un bug, pas à une réunion.
   */
  private readonly maxBytes = 512 * 1024 * 1024

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

  /**
   * Detects buffers with no audible speech. Whisper hallucinates on silence
   * ("Sous-titres réalisés par la communauté d'Amara.org"...), so silent
   * clips are rejected before any network call. Must run on the RAW pcm:
   * enhancement normalizes gain and would amplify room noise.
   * Thresholds are conservative (~-50 dBFS RMS): only near-digital-silence
   * is rejected, a quiet voice passes.
   */
  isLikelySilence(pcm: Buffer): boolean {
    const sampleCount = Math.floor(pcm.length / 2)
    if (sampleCount === 0) return true

    let sumSquares = 0
    let peak = 0
    for (let i = 0; i < sampleCount; i++) {
      const v = pcm.readInt16LE(i * 2)
      sumSquares += v * v
      const abs = Math.abs(v)
      if (abs > peak) peak = abs
    }

    const rms = Math.sqrt(sumSquares / sampleCount)
    return rms < 100 && peak < 500
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
   * Recovers a WAV's duration straight from its own header instead of
   * requiring a caller to have kept it around separately. A recording
   * persisted to `pendingDictationStore` survives on disk as just the WAV —
   * its original `durationMs` is never written alongside it — yet the
   * router's file-path decision (`chooseTranscriptionPath`) depends on that
   * duration. Reading it back from the header (sample rate, channel count
   * and bit depth from `fmt `, byte count from `data`) is what lets the
   * recovery pass in `flushPendingDictations` reproduce the original
   * decision instead of guessing 0, which silently downgrades a long
   * recording that should go to Deepgram onto Groq forever.
   *
   * Every WAV this reads was built by `createWavHeader` above — a fixed
   * 44-byte header with `fmt ` immediately followed by `data` — so this only
   * has to understand that exact layout, not arbitrary WAV files. Files
   * recovered from disk can be truncated or corrupt, so this never throws:
   * it returns null and lets the caller fall back to the old behaviour for
   * that one file rather than aborting the whole recovery pass.
   */
  getWavDurationMs(wavAudio: Buffer): number | null {
    try {
      if (!wavAudio || wavAudio.length < 44) return null
      if (
        wavAudio.toString('ascii', 0, 4) !== 'RIFF' ||
        wavAudio.toString('ascii', 8, 12) !== 'WAVE' ||
        wavAudio.toString('ascii', 12, 16) !== 'fmt ' ||
        wavAudio.toString('ascii', 36, 40) !== 'data'
      ) {
        return null
      }

      const channelCount = wavAudio.readUInt16LE(22)
      const sampleRate = wavAudio.readUInt32LE(24)
      const bitDepth = wavAudio.readUInt16LE(34)
      const declaredDataLength = wavAudio.readUInt32LE(40)

      const blockAlign = channelCount * (bitDepth / 8)
      if (!sampleRate || !blockAlign) return null

      // A truncated file's declared `data` length can outrun what is
      // actually on disk — trust the bytes that are really there instead.
      const dataLength = Math.min(declaredDataLength, wavAudio.length - 44)
      if (dataLength <= 0) return null

      const totalSamples = dataLength / blockAlign
      return Math.floor((totalSamples / sampleRate) * 1000)
    } catch (error) {
      console.warn(
        '[LocalAudioProcessor] Could not read WAV duration from header:',
        error,
      )
      return null
    }
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
    const maxBytes = options.maxBytes || this.maxBytes

    if (!audioPcm || audioPcm.length === 0) {
      throw new Error('No audio data provided')
    }

    if (audioPcm.length > maxBytes) {
      throw new Error('Audio exceeds the 512MB safety limit')
    }

    const bytesPerSample = bitDepth / 8
    const totalSamples = audioPcm.length / bytesPerSample
    const durationMs = Math.floor((totalSamples / sampleRate) * 1000)

    if (durationMs < this.minDurationMs) {
      throw new Error('Audio too short to transcribe')
    }

    if (this.isLikelySilence(audioPcm)) {
      throw new Error('No audible speech in audio (silence)')
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
