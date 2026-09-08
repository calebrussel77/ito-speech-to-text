import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseCliArgs } from './args'
import {
  discoverRecordings,
  hasFreshTranscript,
  transcriptPathFor,
} from './discover'
import { renderTranscriptMarkdown } from './transcriptMarkdown'

describe('parseCliArgs', () => {
  test('defaults: next to the audio, two at a time, history kept', () => {
    const options = parseCliArgs(['C:/calls'])
    expect(options.inputs).toEqual(['C:/calls'])
    expect(options.parallel).toBe(2)
    expect(options.history).toBe(true)
    expect(options.env).toBe('prod')
    expect(options.recursive).toBe(false)
  })

  test('every flag lands', () => {
    const options = parseCliArgs([
      'a.m4a',
      'b.mp3',
      '--out',
      'out',
      '--recursive',
      '--force',
      '--model',
      'nova-3',
      '--language',
      'fr',
      '--parallel',
      '3',
      '--json',
      '--no-history',
      '--env',
      'local',
    ])
    expect(options).toMatchObject({
      inputs: ['a.m4a', 'b.mp3'],
      out: 'out',
      recursive: true,
      force: true,
      model: 'nova-3',
      language: 'fr',
      parallel: 3,
      json: true,
      history: false,
      env: 'local',
    })
  })

  test('refuses a bad parallelism or profile', () => {
    expect(() => parseCliArgs(['x', '--parallel', '0'])).toThrow('--parallel')
    expect(() => parseCliArgs(['x', '--env', 'staging'])).toThrow('--env')
  })
})

describe('discoverRecordings', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ito-cli-'))
    fs.writeFileSync(path.join(dir, 'b-call.m4a'), 'x')
    fs.writeFileSync(path.join(dir, 'a-call.mp3'), 'x')
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'x')
    fs.mkdirSync(path.join(dir, 'sub'))
    fs.writeFileSync(path.join(dir, 'sub', 'c-call.wav'), 'x')
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  test('a folder gives its recordings, sorted, one level deep by default', () => {
    const found = discoverRecordings([dir], { recursive: false })
    expect(found.map(r => path.basename(r.audioPath))).toEqual([
      'a-call.mp3',
      'b-call.m4a',
    ])
    expect(found[0].transcriptPath).toBe(path.join(dir, 'a-call.transcript.md'))
  })

  test('--recursive descends, --out regroups, files are accepted as such', () => {
    const found = discoverRecordings(
      [dir, path.join(dir, 'sub', 'c-call.wav')],
      {
        recursive: true,
        out: path.join(dir, 'transcripts'),
      },
    )
    expect(found.map(r => path.basename(r.audioPath))).toEqual([
      'a-call.mp3',
      'b-call.m4a',
      'c-call.wav',
    ])
    expect(found[2].transcriptPath).toBe(
      path.join(dir, 'transcripts', 'c-call.transcript.md'),
    )
  })

  test('a missing path or a non-recording is an error, not a silence', () => {
    expect(() =>
      discoverRecordings([path.join(dir, 'nope')], { recursive: false }),
    ).toThrow('Not found')
    expect(() =>
      discoverRecordings([path.join(dir, 'notes.txt')], { recursive: false }),
    ).toThrow('Not a recording')
  })

  test('a transcript newer than its audio means nothing to redo', () => {
    const audio = path.join(dir, 'a-call.mp3')
    const recording = {
      audioPath: audio,
      transcriptPath: transcriptPathFor(audio),
    }
    expect(hasFreshTranscript(recording)).toBe(false)
    fs.writeFileSync(recording.transcriptPath, '# done')
    expect(hasFreshTranscript(recording)).toBe(true)
    const later = new Date(Date.now() + 60_000)
    fs.utimesSync(audio, later, later)
    expect(hasFreshTranscript(recording)).toBe(false)
  })
})

describe('renderTranscriptMarkdown', () => {
  test('a conversation: header, then one line per turn with clock and speaker', () => {
    const markdown = renderTranscriptMarkdown({
      audioPath: 'C:/calls/09-02-2026 10.02.m4a',
      recordedAt: new Date(2026, 8, 2, 10, 2),
      durationMs: 46 * 60_000,
      speakerCount: 2,
      engine: 'openrouter/google/gemini-3.7-flash',
      language: 'fr',
      text: 'ignored when there are turns',
      segments: [
        {
          speaker: 0,
          label: 'Speaker 1',
          startMs: 0,
          endMs: 4000,
          text: 'Bonjour',
        },
        {
          speaker: 1,
          label: 'Speaker 2',
          startMs: 65_000,
          endMs: 70_000,
          text: 'Oui ?',
        },
      ],
    })
    expect(markdown).toContain('# 09-02-2026 10.02.m4a')
    expect(markdown).toContain('- Recorded: 2026-09-02 10:02')
    expect(markdown).toContain('- Duration: 46 min')
    expect(markdown).toContain('- Speakers: 2')
    expect(markdown).toContain('- Language: fr')
    expect(markdown).toContain('**[00:00] Speaker 1:** Bonjour')
    expect(markdown).toContain('**[01:05] Speaker 2:** Oui ?')
    expect(markdown).not.toContain('ignored')
  })

  test('a monologue: the text as paragraphs, no labels', () => {
    const markdown = renderTranscriptMarkdown({
      audioPath: 'memo.wav',
      recordedAt: new Date(2026, 0, 1),
      speakerCount: 0,
      engine: 'deepgram/nova-3',
      text: 'Penser à rappeler la clinique.',
      segments: [],
    })
    expect(markdown).toContain('- Speakers: 1 (monologue)')
    expect(
      markdown.endsWith('## Transcript\n\nPenser à rappeler la clinique.\n'),
    ).toBe(true)
  })
})
