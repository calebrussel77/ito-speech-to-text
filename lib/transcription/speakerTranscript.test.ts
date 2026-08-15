import { describe, test, expect } from 'bun:test'
import {
  formatTimestamp,
  uniqueSpeakers,
  formatSpeakerTranscript,
  type SpeakerSegment,
} from './speakersFormat'

const segment = (overrides: Partial<SpeakerSegment>): SpeakerSegment => ({
  speaker: 0,
  label: 'Speaker 1',
  startMs: 0,
  endMs: 1000,
  text: 'hello',
  ...overrides,
})

describe('formatTimestamp', () => {
  test('formats zero as 00:00', () => {
    expect(formatTimestamp(0)).toBe('00:00')
  })

  test('pads minutes and seconds under ten', () => {
    expect(formatTimestamp(65_000)).toBe('01:05')
  })

  test('rounds to the nearest second', () => {
    expect(formatTimestamp(1_499)).toBe('00:01')
    expect(formatTimestamp(1_500)).toBe('00:02')
  })

  test('handles an hour-long meeting', () => {
    expect(formatTimestamp(3_661_000)).toBe('61:01')
  })

  test('clamps a negative value instead of printing a minus sign', () => {
    expect(formatTimestamp(-500)).toBe('00:00')
  })
})

describe('uniqueSpeakers', () => {
  test('returns one entry per speaker, in first-appearance order', () => {
    const segments = [
      segment({ speaker: 1, label: 'Speaker 2' }),
      segment({ speaker: 0, label: 'Speaker 1' }),
      segment({ speaker: 1, label: 'Speaker 2' }),
    ]
    expect(uniqueSpeakers(segments)).toEqual([
      { speaker: 1, label: 'Speaker 2' },
      { speaker: 0, label: 'Speaker 1' },
    ])
  })

  test('a single-speaker meeting yields exactly one entry', () => {
    const segments = [
      segment({ speaker: 0 }),
      segment({ speaker: 0 }),
      segment({ speaker: 0 }),
    ]
    expect(uniqueSpeakers(segments)).toEqual([
      { speaker: 0, label: 'Speaker 1' },
    ])
  })

  test('an empty transcript yields no speakers', () => {
    expect(uniqueSpeakers([])).toEqual([])
  })

  test('keeps the first label seen even if later segments were renamed out of band', () => {
    const segments = [
      segment({ speaker: 0, label: 'Speaker 1' }),
      segment({ speaker: 0, label: 'Speaker 1' }),
    ]
    expect(uniqueSpeakers(segments)).toEqual([
      { speaker: 0, label: 'Speaker 1' },
    ])
  })
})

describe('formatSpeakerTranscript', () => {
  test('formats each segment with its timestamp range, label, and text', () => {
    const segments = [
      segment({
        speaker: 0,
        label: 'Cindy',
        startMs: 0,
        endMs: 900,
        text: 'Hello everyone.',
      }),
      segment({
        speaker: 1,
        label: 'Jeremy',
        startMs: 1_000,
        endMs: 65_000,
        text: 'Hi Cindy.',
      }),
    ]
    expect(formatSpeakerTranscript(segments)).toBe(
      '[00:00-00:01] Cindy: Hello everyone.\n[00:01-01:05] Jeremy: Hi Cindy.',
    )
  })

  test('an empty transcript formats to an empty string', () => {
    expect(formatSpeakerTranscript([])).toBe('')
  })
})
