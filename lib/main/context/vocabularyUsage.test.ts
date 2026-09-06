import { describe, test, expect, beforeEach, mock } from 'bun:test'

let stored: Record<string, unknown> = {}
mock.module('../store', () => ({
  default: {
    get: (key: string) => stored[key],
    set: (key: string, value: unknown) => {
      stored[key] = value
    },
  },
}))

const { recordUsage, sortByUsage } = await import('./vocabularyUsage')

describe('vocabularyUsage', () => {
  beforeEach(() => {
    stored = {}
  })

  test('terms present in the final text are counted, accents and case aside', () => {
    recordUsage("J'ai rajouté un useEffect dans Settings.", [
      'useEffect',
      'Settings',
      'Dokploy',
    ])
    recordUsage('encore un useeffect', ['useEffect', 'Settings'])

    expect(stored.dictionaryUsage).toEqual({ useeffect: 2, settings: 1 })
  })

  test('the most dictated terms come first, ties alphabetical', () => {
    stored.dictionaryUsage = { dokploy: 3, settings: 1 }
    expect(
      sortByUsage(['Zed', 'Settings', 'Alpha', 'Dokploy'], term => term),
    ).toEqual(['Dokploy', 'Settings', 'Alpha', 'Zed'])
  })

  test('nothing is written when no term was dictated', () => {
    recordUsage('rien de connu ici', ['Dokploy'])
    expect(stored.dictionaryUsage).toBeUndefined()
  })
})
