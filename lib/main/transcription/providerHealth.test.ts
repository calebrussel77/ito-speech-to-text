import { describe, test, expect, mock, beforeEach } from 'bun:test'
import crypto from 'crypto'

let advancedSettings: any = {}
const mockStoreSet = mock((_path: string, _value: any) => {})

mock.module('../store', () => ({
  getAdvancedSettings: () => advancedSettings,
  default: { get: mock(() => undefined), set: mockStoreSet },
  store: { get: mock(() => undefined), set: mockStoreSet },
}))

const KEY = 'sk-or-v1-real'
const OTHER_KEY = 'sk-or-v1-regenerated'

const fingerprintOf = (key: string) =>
  crypto.createHash('sha256').update(key.trim()).digest('hex').slice(0, 16)

const {
  clearProviderFailure,
  failureNotice,
  getProviderFailure,
  getRejectedKeyFailure,
  recordProviderFailure,
} = await import('./providerHealth')

/** Records a failure and feeds it back in as if it had been persisted. */
const persistFailure = (
  provider: 'openrouter' | 'deepgram',
  code: string,
  apiKey = KEY,
) => {
  recordProviderFailure({
    provider,
    code,
    message: 'OpenRouter rejected the API key',
    model: 'qwen/qwen3-asr-flash-2026-02-10',
    apiKey,
  })
  advancedSettings = {
    providerFailures: {
      [provider]: mockStoreSet.mock.calls.at(-1)?.[1],
    },
  }
}

describe('providerHealth', () => {
  beforeEach(() => {
    advancedSettings = {}
    mockStoreSet.mockClear()
  })

  test('stores the failure under advancedSettings.providerFailures.<provider>', () => {
    recordProviderFailure({
      provider: 'openrouter',
      code: 'INVALID_API_KEY',
      message: 'refused',
      model: 'qwen/qwen3-asr-flash-2026-02-10',
      apiKey: KEY,
    })

    const [path, value] = mockStoreSet.mock.calls[0]
    expect(path).toBe('advancedSettings.providerFailures.openrouter')
    expect(value).toMatchObject({
      code: 'INVALID_API_KEY',
      model: 'qwen/qwen3-asr-flash-2026-02-10',
    })
    // The key itself must never reach the store, only a digest of it.
    expect(JSON.stringify(value)).not.toContain(KEY)
  })

  test('reports the failure for the key that earned it', () => {
    persistFailure('openrouter', 'INVALID_API_KEY')

    expect(getProviderFailure('openrouter', KEY)?.code).toBe('INVALID_API_KEY')
    expect(getRejectedKeyFailure('openrouter', KEY)?.code).toBe(
      'INVALID_API_KEY',
    )
  })

  test('a new key makes the record stale, with nothing to clear', () => {
    persistFailure('openrouter', 'INVALID_API_KEY')

    expect(getProviderFailure('openrouter', OTHER_KEY)).toBeNull()
    expect(getRejectedKeyFailure('openrouter', OTHER_KEY)).toBeNull()
  })

  test('transient failures never suppress the next attempt', () => {
    persistFailure('openrouter', 'RATE_LIMIT')

    expect(getProviderFailure('openrouter', KEY)?.code).toBe('RATE_LIMIT')
    expect(getRejectedKeyFailure('openrouter', KEY)).toBeNull()
  })

  test('no record and no key both read as healthy', () => {
    expect(getProviderFailure('openrouter', KEY)).toBeNull()
    persistFailure('openrouter', 'INVALID_API_KEY')
    expect(getProviderFailure('openrouter', '')).toBeNull()
    expect(getProviderFailure('openrouter', undefined)).toBeNull()
  })

  test('clearing only writes when there is something to clear', () => {
    clearProviderFailure('openrouter')
    expect(mockStoreSet).not.toHaveBeenCalled()

    persistFailure('openrouter', 'INVALID_API_KEY')
    mockStoreSet.mockClear()
    clearProviderFailure('openrouter')
    expect(mockStoreSet).toHaveBeenCalledWith(
      'advancedSettings.providerFailures.openrouter',
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
    const notices = codes.map(code => failureNotice('openrouter', code))

    expect(new Set(notices).size).toBe(codes.length)
    expect(failureNotice('openrouter', 'UNKNOWN')).toContain('OpenRouter')
    expect(failureNotice('openrouter', undefined)).toContain('OpenRouter')
  })

  test('an old single-provider record is read as the OpenRouter one', () => {
    // Le réglage passe d'un objet unique à une map par fournisseur ; les
    // installations existantes portent l'ancienne forme.
    advancedSettings = {
      openRouterFailure: {
        code: 'INVALID_API_KEY',
        message: 'refused',
        model: 'x',
        at: '2026-08-14T00:00:00.000Z',
        keyFingerprint: fingerprintOf(KEY),
      },
    }

    expect(getProviderFailure('openrouter', KEY)?.code).toBe('INVALID_API_KEY')
    expect(getProviderFailure('deepgram', KEY)).toBeNull()
  })

  test('a success after a legacy rejection permanently clears it, not just until the next read', () => {
    // Installation mise à niveau : une vraie panne OpenRouter existe encore
    // sous l'ancien champ, avant que `providerFailures` n'existe.
    advancedSettings = {
      openRouterFailure: {
        code: 'INVALID_API_KEY',
        message: 'refused',
        model: 'x',
        at: '2026-08-14T00:00:00.000Z',
        keyFingerprint: fingerprintOf(KEY),
      },
    }

    // 1. Premier lancement après la mise à niveau : le dossier hérité est lu.
    expect(getProviderFailure('openrouter', KEY)?.code).toBe('INVALID_API_KEY')
    expect(getRejectedKeyFailure('openrouter', KEY)?.code).toBe(
      'INVALID_API_KEY',
    )

    // 2. L'utilisateur corrige sa clé, la dictée suivante réussit.
    mockStoreSet.mockClear()
    clearProviderFailure('openrouter')
    expect(mockStoreSet).toHaveBeenCalledWith(
      'advancedSettings.providerFailures.openrouter',
      null,
    )
    // Le vrai store ne supprime jamais une clé : `deepSet` écrit un `null`
    // explicite. On reproduit donc exactement ce que le store produirait,
    // plutôt que de remplacer l'objet entier et perdre le champ hérité.
    advancedSettings = {
      ...advancedSettings,
      providerFailures: { openrouter: null },
    }

    // 3. Toute lecture suivante doit rester saine : l'entrée explicite gagne
    // sur le champ hérité, sinon le contournement de la clé refusée ne serait
    // jamais levé — et la dictée longue resterait dégradée vers Groq pour
    // toujours, même avec une clé qui fonctionne à nouveau.
    expect(getProviderFailure('openrouter', KEY)).toBeNull()
    expect(getRejectedKeyFailure('openrouter', KEY)).toBeNull()
  })

  test('each provider keeps its own record', () => {
    recordProviderFailure({
      provider: 'deepgram',
      code: 'INVALID_API_KEY',
      message: 'refused',
      model: 'deepgram/nova-3',
      apiKey: KEY,
    })

    const [path] = mockStoreSet.mock.calls.at(-1)!
    expect(path).toBe('advancedSettings.providerFailures.deepgram')
  })

  test('the notice names the provider that failed', () => {
    expect(failureNotice('deepgram', 'INVALID_API_KEY')).toContain('Deepgram')
    expect(failureNotice('openrouter', 'INVALID_API_KEY')).toContain(
      'OpenRouter',
    )
  })
})
