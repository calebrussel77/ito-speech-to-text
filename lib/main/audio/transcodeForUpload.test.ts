import { describe, test, expect, mock, beforeEach } from 'bun:test'

let mp3FromWav: Buffer | null = null
mock.module('./wavToMp3', () => ({
  wavToMp3: mock(async () => mp3FromWav),
}))

let ffmpegExists = true
let ffmpegOutput: Buffer | null = Buffer.from('ffmpeg-mp3')
const spawnCalls: string[][] = []
mock.module('child_process', () => ({
  execFile: (
    _cmd: string,
    _args: string[],
    _opts: unknown,
    cb: (error: Error | null) => void,
  ) => cb(ffmpegExists ? null : new Error('ENOENT')),
  spawn: (_cmd: string, args: string[]) => {
    spawnCalls.push(args)
    const listeners: Record<string, ((arg: any) => void)[]> = {}
    const on =
      (target: Record<string, ((arg: any) => void)[]>) =>
      (event: string, fn: (arg: any) => void) => {
        ;(target[event] ??= []).push(fn)
      }
    const stdout: Record<string, ((arg: any) => void)[]> = {}
    const stderr: Record<string, ((arg: any) => void)[]> = {}
    const child = {
      stdout: { on: on(stdout) },
      stderr: { on: on(stderr) },
      on: on(listeners),
      kill: () => {},
    }
    setTimeout(() => {
      if (ffmpegOutput) stdout.data?.forEach(fn => fn(ffmpegOutput))
      listeners.close?.forEach(fn => fn(ffmpegOutput ? 0 : 1))
    }, 0)
    return child
  },
}))

const { prepareUploadAudio, contentTypeFor, resetFfmpegDetection } =
  await import('./transcodeForUpload')

describe('prepareUploadAudio', () => {
  beforeEach(() => {
    resetFfmpegDetection()
    spawnCalls.length = 0
    mp3FromWav = null
    ffmpegExists = true
    ffmpegOutput = Buffer.from('ffmpeg-mp3')
  })

  test('a WAV goes through the in-app encoder, never ffmpeg', async () => {
    mp3FromWav = Buffer.from('mp3')
    const result = await prepareUploadAudio('C:/memo.wav', Buffer.alloc(100))
    expect(result).toMatchObject({
      contentType: 'audio/mpeg',
      fileName: 'memo.mp3',
      transcoded: true,
    })
    expect(spawnCalls).toHaveLength(0)
  })

  test('an m4a is decoded and re-encoded mono 16 kHz 48 kbit/s by ffmpeg', async () => {
    const result = await prepareUploadAudio(
      'C:/Users/x/09-02-2026 10.02.m4a',
      Buffer.alloc(1000),
    )
    expect(result.transcoded).toBe(true)
    expect(result.contentType).toBe('audio/mpeg')
    expect(result.fileName).toBe('09-02-2026 10.02.mp3')
    expect(spawnCalls[0]).toEqual(
      expect.arrayContaining(['-ac', '1', '-ar', '16000', '-b:a', '48k']),
    )
  })

  test('a light MP3 is sent as it is', async () => {
    const result = await prepareUploadAudio('C:/call.mp3', Buffer.alloc(1000))
    expect(result.transcoded).toBe(false)
    expect(spawnCalls).toHaveLength(0)
  })

  test('without ffmpeg, or when ffmpeg fails, the original is sent', async () => {
    ffmpegExists = false
    let result = await prepareUploadAudio('C:/call.m4a', Buffer.alloc(1000))
    expect(result).toMatchObject({
      contentType: 'audio/mp4',
      transcoded: false,
    })

    resetFfmpegDetection()
    ffmpegExists = true
    ffmpegOutput = null
    result = await prepareUploadAudio('C:/call.m4a', Buffer.alloc(1000))
    expect(result.transcoded).toBe(false)
  })

  test('a re-encode that is not smaller is discarded', async () => {
    ffmpegOutput = Buffer.alloc(5000)
    const result = await prepareUploadAudio('C:/call.ogg', Buffer.alloc(1000))
    expect(result.transcoded).toBe(false)
  })

  test('content types follow the extension', () => {
    expect(contentTypeFor('a.M4A')).toBe('audio/mp4')
    expect(contentTypeFor('a.webm')).toBe('audio/webm')
    expect(contentTypeFor('a.unknown')).toBe('audio/wav')
  })
})
