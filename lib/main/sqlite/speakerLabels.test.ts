import { describe, test, expect, mock, beforeEach } from 'bun:test'

let row: any = null
const mockRun = mock(async (_q: string, _p: any[]) => {})
const mockGet = mock(async (_q: string, _p: any[]) => row)

mock.module('./utils', () => ({
  run: mockRun,
  get: mockGet,
  all: mock(async () => []),
}))

const { InteractionsTable } = await import('./repo')

const withSpeakers = (speakers: any[]) => ({
  id: 'i1',
  asr_output: JSON.stringify({ transcript: 't', speakers }),
  llm_output: '{}',
})

describe('InteractionsTable.updateSpeakerLabels', () => {
  beforeEach(() => {
    row = null
    mockRun.mockClear()
    mockGet.mockClear()
  })

  test('renaming a speaker rewrites every one of their segments', async () => {
    row = withSpeakers([
      { speaker: 0, label: 'Speaker 1', startMs: 0, endMs: 900, text: 'a' },
      { speaker: 1, label: 'Speaker 2', startMs: 1000, endMs: 1500, text: 'b' },
      { speaker: 0, label: 'Speaker 1', startMs: 2000, endMs: 2500, text: 'c' },
    ])

    await InteractionsTable.updateSpeakerLabels('i1', {
      0: 'Cindy',
      1: 'Jeremy',
    })

    const [, params] = mockRun.mock.calls.at(-1)!
    expect(JSON.parse(params[0]).speakers.map((s: any) => s.label)).toEqual([
      'Cindy',
      'Jeremy',
      'Cindy',
    ])
  })

  test('renaming only some speakers leaves the others alone', async () => {
    row = withSpeakers([
      { speaker: 0, label: 'Speaker 1', startMs: 0, endMs: 1, text: 'a' },
      { speaker: 1, label: 'Speaker 2', startMs: 1, endMs: 2, text: 'b' },
    ])

    await InteractionsTable.updateSpeakerLabels('i1', { 0: 'Cindy' })

    const [, params] = mockRun.mock.calls.at(-1)!
    expect(JSON.parse(params[0]).speakers[1].label).toBe('Speaker 2')
  })

  test('an empty name is ignored rather than blanking the label', async () => {
    row = withSpeakers([
      { speaker: 0, label: 'Speaker 1', startMs: 0, endMs: 1, text: 'a' },
    ])

    await InteractionsTable.updateSpeakerLabels('i1', { 0: '   ' })

    const [, params] = mockRun.mock.calls.at(-1)!
    expect(JSON.parse(params[0]).speakers[0].label).toBe('Speaker 1')
  })

  test('an interaction without speakers is a no-op, not a crash', async () => {
    row = {
      id: 'i1',
      asr_output: JSON.stringify({ transcript: 't' }),
      llm_output: '{}',
    }

    const result = await InteractionsTable.updateSpeakerLabels('i1', {
      0: 'Cindy',
    })

    expect(mockRun).not.toHaveBeenCalled()
    expect(result).toBe(false)
  })

  test('an unknown interaction id is a no-op, not a crash', async () => {
    row = null

    const result = await InteractionsTable.updateSpeakerLabels('missing', {
      0: 'Cindy',
    })

    expect(mockRun).not.toHaveBeenCalled()
    expect(result).toBe(false)
  })

  test('a null or undefined labels argument is a safe no-op, not a crash', async () => {
    row = withSpeakers([
      { speaker: 0, label: 'Speaker 1', startMs: 0, endMs: 1, text: 'a' },
    ])

    const resultNull = await InteractionsTable.updateSpeakerLabels(
      'i1',
      null as any,
    )
    const resultUndefined = await InteractionsTable.updateSpeakerLabels(
      'i1',
      undefined as any,
    )

    expect(mockRun).not.toHaveBeenCalled()
    expect(resultNull).toBe(false)
    expect(resultUndefined).toBe(false)
  })

  test('a successful rename reports back that it renamed', async () => {
    row = withSpeakers([
      { speaker: 0, label: 'Speaker 1', startMs: 0, endMs: 1, text: 'a' },
    ])

    const result = await InteractionsTable.updateSpeakerLabels('i1', {
      0: 'Cindy',
    })

    expect(result).toBe(true)
  })

  test('the rest of asr_output survives the rewrite', async () => {
    row = {
      id: 'i1',
      asr_output: JSON.stringify({
        transcript: 't',
        rawTranscript: 'raw',
        modeName: 'Meeting',
        speakers: [
          { speaker: 0, label: 'Speaker 1', startMs: 0, endMs: 1, text: 'a' },
        ],
      }),
      llm_output: '{}',
    }

    await InteractionsTable.updateSpeakerLabels('i1', { 0: 'Cindy' })

    const stored = JSON.parse(mockRun.mock.calls.at(-1)![1][0])
    expect(stored.rawTranscript).toBe('raw')
    expect(stored.modeName).toBe('Meeting')
  })
})
