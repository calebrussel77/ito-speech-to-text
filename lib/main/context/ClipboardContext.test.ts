import { describe, test, expect, mock, beforeEach } from 'bun:test'

let clipboardContent = ''
let shouldThrow = false

mock.module('electron', () => ({
  clipboard: {
    readText: () => {
      if (shouldThrow) throw new Error('clipboard unavailable')
      return clipboardContent
    },
  },
}))

const { readClipboardText, rememberInsertedText } = await import(
  './ClipboardContext'
)

describe('readClipboardText', () => {
  beforeEach(() => {
    clipboardContent = ''
    shouldThrow = false
  })

  test('returns the clipboard text', () => {
    clipboardContent = '  a meeting transcript  '
    expect(readClipboardText()).toBe('a meeting transcript')
  })

  test('truncates on a word boundary and says so', () => {
    clipboardContent = 'alpha beta gamma delta'
    const result = readClipboardText(12)

    expect(result.startsWith('alpha beta')).toBe(true)
    expect(result).toContain('[truncated]')
    expect(result.length).toBeLessThan(clipboardContent.length + 20)
  })

  test('an unreadable clipboard yields an empty string, never an exception', () => {
    shouldThrow = true
    expect(readClipboardText()).toBe('')
  })

  test('an empty clipboard yields an empty string', () => {
    expect(readClipboardText()).toBe('')
  })

  test('Ito never feeds itself its own previous dictation', () => {
    // Sous Windows l'insertion passe par le presse-papier et ne le restaure
    // pas : sans ce garde-fou, un mode « résume le presse-papier » résumerait
    // sa propre sortie précédente.
    rememberInsertedText('Le compte rendu de la réunion de mardi.')
    clipboardContent = 'Le compte rendu de la réunion de mardi.'

    expect(readClipboardText()).toBe('')
  })

  test('the guard compares after trimming, not byte for byte', () => {
    rememberInsertedText('bonjour')
    clipboardContent = '  bonjour  '
    expect(readClipboardText()).toBe('')
  })

  test('copying something else clears the guard', () => {
    rememberInsertedText('bonjour')
    clipboardContent = 'un vrai document'

    expect(readClipboardText()).toBe('un vrai document')
  })
})
