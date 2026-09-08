import { describe, expect, test } from 'bun:test'
import crypto from 'node:crypto'
import { decryptV10 } from './safeStorage'

describe('decryptV10', () => {
  test('reads back what Chromium os_crypt writes: v10, nonce, ciphertext, tag', () => {
    const key = crypto.randomBytes(32)
    const nonce = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce)
    const data = Buffer.concat([
      cipher.update('sk-or-v1-secret', 'utf8'),
      cipher.final(),
    ])
    const blob = Buffer.concat([
      Buffer.from('v10'),
      nonce,
      data,
      cipher.getAuthTag(),
    ])

    expect(decryptV10(key, blob)).toBe('sk-or-v1-secret')
  })

  test('refuses a blob without the version prefix', () => {
    expect(() =>
      decryptV10(crypto.randomBytes(32), Buffer.from('nope')),
    ).toThrow('Unexpected ciphertext format')
  })
})
