import { describe, test, expect } from 'bun:test'
import { monoPcmChunks, readWavInfo, wavToMp3 } from './wavToMp3'

function wav(options: {
  sampleRate: number
  channels: number
  bitDepth?: number
  frames: number[][]
  extraChunk?: boolean
}): Buffer {
  const bitDepth = options.bitDepth ?? 16
  const blockAlign = options.channels * (bitDepth / 8)
  const data = Buffer.alloc(options.frames.length * blockAlign)
  options.frames.forEach((frame, i) => {
    frame.forEach((sample, c) => {
      data.writeInt16LE(sample, i * blockAlign + c * 2)
    })
  })
  const fmt = Buffer.alloc(24)
  fmt.write('fmt ', 0)
  fmt.writeUInt32LE(16, 4)
  fmt.writeUInt16LE(1, 8)
  fmt.writeUInt16LE(options.channels, 10)
  fmt.writeUInt32LE(options.sampleRate, 12)
  fmt.writeUInt32LE(options.sampleRate * blockAlign, 16)
  fmt.writeUInt16LE(blockAlign, 20)
  fmt.writeUInt16LE(bitDepth, 22)
  // A LIST chunk before the data, as real recorders write.
  const list = options.extraChunk
    ? Buffer.concat([
        Buffer.from('LIST'),
        Buffer.from([3, 0, 0, 0]),
        Buffer.from('abc\0'),
      ])
    : Buffer.alloc(0)
  const dataHeader = Buffer.alloc(8)
  dataHeader.write('data', 0)
  dataHeader.writeUInt32LE(data.length, 4)
  const riff = Buffer.alloc(12)
  riff.write('RIFF', 0)
  riff.writeUInt32LE(4 + fmt.length + list.length + 8 + data.length, 4)
  riff.write('WAVE', 8)
  return Buffer.concat([riff, fmt, list, dataHeader, data])
}

describe('readWavInfo', () => {
  test('walks past extra chunks to find the format and the data', () => {
    const info = readWavInfo(
      wav({
        sampleRate: 44100,
        channels: 2,
        frames: [[1, 2]],
        extraChunk: true,
      }),
    )
    expect(info).toMatchObject({ sampleRate: 44100, channels: 2, bitDepth: 16 })
    expect(info!.dataLength).toBe(4)
  })

  test('rejects what is not 16-bit PCM WAV', () => {
    expect(readWavInfo(Buffer.from('ID3\x03\x00'))).toBeNull()
    expect(
      readWavInfo(
        wav({ sampleRate: 16000, channels: 1, bitDepth: 24, frames: [[1]] }),
      ),
    ).toBeNull()
  })
})

describe('monoPcmChunks', () => {
  test('averages stereo frames and copies mono frames', () => {
    const stereo = wav({
      sampleRate: 16000,
      channels: 2,
      frames: [
        [1000, 3000],
        [-2000, 0],
      ],
    })
    const chunks = [...monoPcmChunks(stereo, readWavInfo(stereo)!)]
    const samples = Array.from({ length: 2 }, (_, i) =>
      chunks[0].readInt16LE(i * 2),
    )
    expect(samples).toEqual([2000, -1000])

    const mono = wav({
      sampleRate: 16000,
      channels: 1,
      frames: [[7], [8], [9]],
    })
    const parts = [...monoPcmChunks(mono, readWavInfo(mono)!, 2)]
    expect(parts.map(p => p.length)).toEqual([4, 2])
  })
})

describe('wavToMp3', () => {
  test('gives up quietly on a file it cannot encode', async () => {
    expect(await wavToMp3(Buffer.from('not a wav'))).toBeNull()
  })

  test('returns null when the encoder yields nothing, so the original is sent', async () => {
    // The global test setup replaces the worker-backed encoder with one that
    // produces nothing: the caller must then fall back to the original file.
    const file = wav({ sampleRate: 16000, channels: 1, frames: [[1], [2]] })
    expect(await wavToMp3(file)).toBeNull()
  })
})
