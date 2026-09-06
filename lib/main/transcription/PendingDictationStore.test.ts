import { describe, test, expect } from 'bun:test'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { PendingDictationStore } from './PendingDictationStore'

const makeStore = () =>
  new PendingDictationStore(
    fs.mkdtempSync(path.join(os.tmpdir(), 'ito-pending-test-')),
  )

describe('PendingDictationStore', () => {
  test('save / list / read / delete roundtrip', () => {
    const store = makeStore()
    const audio = Buffer.from('fake wav content')

    const filePath = store.save(audio)
    expect(fs.existsSync(filePath)).toBe(true)
    expect(store.list()).toEqual([filePath])
    expect(store.read(filePath).equals(audio)).toBe(true)

    store.delete(filePath)
    expect(store.list()).toEqual([])
  })

  test('list returns oldest first and ignores non-wav files', () => {
    const store = makeStore()
    const first = store.save(Buffer.from('a'))
    const second = store.save(Buffer.from('b'))
    fs.writeFileSync(path.join(path.dirname(first), 'notes.txt'), 'x')

    const listed = store.list()
    expect(listed).toEqual([first, second])
  })

  test('the mode and context sidecar round-trips and disappears with its WAV', () => {
    const store = makeStore()
    const filePath = store.save(Buffer.from('wav'))
    const meta = {
      modeId: 'email',
      modeName: 'Email',
      durationMs: 4200,
      context: {
        vocabularyWords: ['Ito'],
        dictionaryEntries: ['Ito', { from: 'Itto', to: 'Ito' }],
        windowTitle: 'Inbox',
        appName: 'Mail',
        contextText: 'selected',
        clipboardText: '',
      },
    }

    store.writeMeta(filePath, meta)
    expect(store.readMeta(filePath)).toEqual(meta)
    // The sidecar is not a pending dictation of its own.
    expect(store.list()).toEqual([filePath])

    store.delete(filePath)
    expect(fs.existsSync(filePath.replace(/\.wav$/, '.json'))).toBe(false)
  })

  test('a WAV from before sidecars, or a corrupt sidecar, reads as no meta', () => {
    const store = makeStore()
    const legacy = store.save(Buffer.from('wav'))
    expect(store.readMeta(legacy)).toBeNull()

    fs.writeFileSync(legacy.replace(/\.wav$/, '.json'), '{not json')
    expect(store.readMeta(legacy)).toBeNull()
  })

  test('delete is idempotent and list survives a missing directory', () => {
    const store = new PendingDictationStore(
      path.join(os.tmpdir(), 'ito-pending-does-not-exist'),
    )
    expect(store.list()).toEqual([])
    expect(() => store.delete('C:/nope/missing.wav')).not.toThrow()
  })
})
