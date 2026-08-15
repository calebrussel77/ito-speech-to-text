import { describe, test, expect } from 'bun:test'
import { ENCRYPTED_API_KEY_FIELDS } from './store'

describe('Deepgram key storage', () => {
  test('the Deepgram key is encrypted at rest like the other two', () => {
    expect([...ENCRYPTED_API_KEY_FIELDS]).toEqual([
      'groqApiKey',
      'openRouterApiKey',
      'deepgramApiKey',
    ])
  })
})
