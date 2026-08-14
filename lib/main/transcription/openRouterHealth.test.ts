import { describe, test, expect, mock, beforeEach } from 'bun:test'

let advancedSettings: any = {}
const mockStoreSet = mock((_path: string, _value: any) => {})

mock.module('../store', () => ({
  getAdvancedSettings: () => advancedSettings,
  default: { get: mock(() => undefined), set: mockStoreSet },
  store: { get: mock(() => undefined), set: mockStoreSet },
}))

const KEY = 'sk-or-v1-real'
const OTHER_KEY = 'sk-or-v1-regenerated'

const {
  clearOpenRouterFailure,
  failureNotice,
  getOpenRouterFailure,
  getRejectedKeyFailure,
  recordOpenRouterFailure,
} = await import('./openRouterHealth')

/** Records a failure and feeds it back in as if it had been persisted. */
const persistFailure = (code: string, apiKey = KEY) => {
  recordOpenRouterFailure({
    code,
    message: 'OpenRouter rejected the API key',
    model: 'qwen/qwen3-asr-flash-2026-02-10',
    apiKey,
  })
  advancedSettings = {
    openRouterFailure: mockStoreSet.mock.calls.at(-1)?.[1],
  }
}

describe('openRouterHealth', () => {
  beforeEach(() => {
    advancedSettings = {}
    mockStoreSet.mockClear()
  })

  test('stores the failure under advancedSettings', () => {
    recordOpenRouterFailure({
      code: 'INVALID_API_KEY',
      message: 'refused',
      model: 'qwen/qwen3-asr-flash-2026-02-10',
      apiKey: KEY,
    })

    const [path, value] = mockStoreSet.mock.calls[0]
    expect(path).toBe('advancedSettings.openRouterFailure')
    expect(value).toMatchObject({
      code: 'INVALID_API_KEY',
      model: 'qwen/qwen3-asr-flash-2026-02-10',
    })
    // The key itself must never reach the store, only a digest of it.
    expect(JSON.stringify(value)).not.toContain(KEY)
  })

  test('reports the failure for the key that earned it', () => {
    persistFailure('INVALID_API_KEY')

    expect(getOpenRouterFailure(KEY)?.code).toBe('INVALID_API_KEY')
    expect(getRejectedKeyFailure(KEY)?.code).toBe('INVALID_API_KEY')
  })

  test('a new key makes the record stale, with nothing to clear', () => {
    persistFailure('INVALID_API_KEY')

    expect(getOpenRouterFailure(OTHER_KEY)).toBeNull()
    expect(getRejectedKeyFailure(OTHER_KEY)).toBeNull()
  })

  test('transient failures never suppress the next attempt', () => {
    persistFailure('RATE_LIMIT')

    expect(getOpenRouterFailure(KEY)?.code).toBe('RATE_LIMIT')
    expect(getRejectedKeyFailure(KEY)).toBeNull()
  })

  test('no record and no key both read as healthy', () => {
    expect(getOpenRouterFailure(KEY)).toBeNull()
    persistFailure('INVALID_API_KEY')
    expect(getOpenRouterFailure('')).toBeNull()
    expect(getOpenRouterFailure(undefined)).toBeNull()
  })

  test('clearing only writes when there is something to clear', () => {
    clearOpenRouterFailure()
    expect(mockStoreSet).not.toHaveBeenCalled()

    persistFailure('INVALID_API_KEY')
    mockStoreSet.mockClear()
    clearOpenRouterFailure()
    expect(mockStoreSet).toHaveBeenCalledWith(
      'advancedSettings.openRouterFailure',
      null,
    )
  })

  test('every code the transcription service can raise has its own notice', () => {
    const codes = [
      'INVALID_API_KEY',
      'MISSING_API_KEY',
      'RATE_LIMIT',
      'NETWORK',
      'MODEL_ERROR',
    ]
    const notices = codes.map(failureNotice)

    expect(new Set(notices).size).toBe(codes.length)
    expect(failureNotice('UNKNOWN')).toContain('OpenRouter')
    expect(failureNotice(undefined)).toContain('OpenRouter')
  })
})
