import { describe, test, expect } from 'bun:test'
import { LocalAudioProcessor } from './LocalAudioProcessor'

const processor = new LocalAudioProcessor()

function pcmFromSamples(samples: number[]): Buffer {
  const buf = Buffer.alloc(samples.length * 2)
  samples.forEach((s, i) => buf.writeInt16LE(s, i * 2))
  return buf
}

function sineWavePcm(durationMs: number, amplitude: number): Buffer {
  const sampleRate = 16000
  const count = Math.floor((durationMs / 1000) * sampleRate)
  const samples = Array.from({ length: count }, (_, i) =>
    Math.round(amplitude * Math.sin((2 * Math.PI * 440 * i) / sampleRate)),
  )
  return pcmFromSamples(samples)
}

describe('isLikelySilence', () => {
  test('flags digital silence', () => {
    expect(
      processor.isLikelySilence(pcmFromSamples(new Array(1600).fill(0))),
    ).toBe(true)
  })

  test('flags near-silent room noise', () => {
    const noise = Array.from({ length: 1600 }, () =>
      Math.round((Math.random() - 0.5) * 40),
    )
    expect(processor.isLikelySilence(pcmFromSamples(noise))).toBe(true)
  })

  test('does not flag a quiet but audible signal', () => {
    expect(processor.isLikelySilence(sineWavePcm(100, 1000))).toBe(false)
  })

  test('does not flag normal speech levels', () => {
    expect(processor.isLikelySilence(sineWavePcm(100, 8000))).toBe(false)
  })
})

describe('prepareAudioForTranscription silence guard', () => {
  test('rejects silent clips before any network call', () => {
    const silent = pcmFromSamples(new Array(16000).fill(0)) // 1s of silence
    expect(() =>
      processor.prepareAudioForTranscription(silent, { sampleRate: 16000 }),
    ).toThrow('No audible speech')
  })

  test('accepts clips with audible speech', () => {
    const result = processor.prepareAudioForTranscription(
      sineWavePcm(500, 8000),
      { sampleRate: 16000 },
    )
    expect(result.durationMs).toBeGreaterThanOrEqual(490)
    expect(result.wavAudio.length).toBeGreaterThan(44)
  })
})

describe('getWavDurationMs', () => {
  test('recovers the duration a WAV was built with', () => {
    const { wavAudio, durationMs } = processor.prepareAudioForTranscription(
      sineWavePcm(2000, 8000),
      { sampleRate: 16000, enhance: false },
    )

    const recovered = processor.getWavDurationMs(wavAudio)

    // enhancePcm16 is skipped above so the sample count — and therefore the
    // duration — is untouched by processing; the header round-trips exactly.
    expect(recovered).toBe(durationMs)
  })

  test('accounts for channel count and bit depth, not just byte count', () => {
    const header = processor.createWavHeader(3200, 16000, 2, 16)
    const wav = Buffer.concat([header, Buffer.alloc(3200)])

    // 3200 bytes / (2 channels * 2 bytes) = 800 frames at 16kHz = 50ms.
    expect(processor.getWavDurationMs(wav)).toBe(50)
  })

  test('returns null for a buffer shorter than a WAV header', () => {
    expect(processor.getWavDurationMs(Buffer.alloc(10))).toBeNull()
  })

  test('returns null when the RIFF/WAVE/fmt/data markers are missing', () => {
    const garbage = Buffer.alloc(100)
    garbage.write('NOPE', 0)
    expect(processor.getWavDurationMs(garbage)).toBeNull()
  })

  test('does not throw on random short garbage', () => {
    const garbage = Buffer.from([1, 2, 3, 4, 5])
    expect(() => processor.getWavDurationMs(garbage)).not.toThrow()
    expect(processor.getWavDurationMs(garbage)).toBeNull()
  })

  test('falls back to the bytes actually present when the data chunk was truncated', () => {
    const { wavAudio } = processor.prepareAudioForTranscription(
      sineWavePcm(2000, 8000),
      { sampleRate: 16000, enhance: false },
    )
    // Chop the file in half after the header: the `data` chunk size field
    // still claims the original (larger) length.
    const truncated = wavAudio.subarray(0, 44 + (wavAudio.length - 44) / 2)

    const recovered = processor.getWavDurationMs(truncated)

    expect(recovered).not.toBeNull()
    expect(recovered as number).toBeLessThan(2000)
    expect(recovered as number).toBeGreaterThan(0)
  })

  test('returns null when sample rate is zero', () => {
    const header = processor.createWavHeader(1600, 0, 1, 16)
    const wav = Buffer.concat([header, Buffer.alloc(1600)])
    expect(processor.getWavDurationMs(wav)).toBeNull()
  })
})
