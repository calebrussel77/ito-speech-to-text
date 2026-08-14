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
