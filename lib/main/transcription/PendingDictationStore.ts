import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import type { DictionaryTerm } from './DictionaryCorrector'

/**
 * Ce qui, hors audio, doit survivre à un échec pour que la reprise rejoue la
 * dictée comme si elle n'avait jamais échoué : le mode d'origine et le
 * contexte capturé au moment de la dictée. Les réglages avancés (clés API)
 * ne sont volontairement pas écrits ici : ils sont relus à la reprise.
 */
export interface PendingDictationMeta {
  modeId: string
  modeName: string
  durationMs: number
  context: {
    vocabularyWords: string[]
    dictionaryEntries: DictionaryTerm[]
    windowTitle: string
    appName: string
    contextText: string
    clipboardText: string
  }
}

/**
 * Disk-backed holding area for dictation audio. A WAV is written here BEFORE
 * the transcription network call and deleted after success, so a network
 * failure, an API outage or an app crash can never lose a dictation: the
 * audio survives on disk and is recovered later.
 *
 * A JSON sidecar (same name, `.json`) carries the mode and context so the
 * recovery pass can apply the same settings as the original dictation.
 */
export class PendingDictationStore {
  private baseDir?: string
  private resolvedDir: string | null = null

  constructor(baseDir?: string) {
    this.baseDir = baseDir
  }

  // Lazy: app.getPath is only available once Electron is initialized.
  private get dir(): string {
    if (!this.resolvedDir) {
      this.resolvedDir =
        this.baseDir ?? path.join(app.getPath('userData'), 'pending-dictations')
    }
    return this.resolvedDir
  }

  private ensureDir(): void {
    fs.mkdirSync(this.dir, { recursive: true })
  }

  // Monotonic suffix keeps list() order deterministic within a run even when
  // two dictations land in the same millisecond.
  private sequence = 0

  private nextPath(): string {
    const sequence = (this.sequence++).toString().padStart(4, '0')
    return path.join(this.dir, `dictation-${Date.now()}-${sequence}.wav`)
  }

  save(wavAudio: Buffer): string {
    this.ensureDir()
    const filePath = this.nextPath()
    fs.writeFileSync(filePath, wavAudio)
    return filePath
  }

  /** Même chose que `save`, sans bloquer le processus principal. */
  async saveAsync(wavAudio: Buffer): Promise<string> {
    this.ensureDir()
    const filePath = this.nextPath()
    await fs.promises.writeFile(filePath, wavAudio)
    return filePath
  }

  private metaPath(wavPath: string): string {
    return wavPath.replace(/\.wav$/, '.json')
  }

  /** Écrit le sidecar d'un WAV déjà sauvegardé. Ne lève jamais. */
  writeMeta(wavPath: string, meta: PendingDictationMeta): void {
    try {
      fs.writeFileSync(this.metaPath(wavPath), JSON.stringify(meta))
    } catch (error) {
      console.warn('[PendingDictationStore] Could not write meta:', error)
    }
  }

  /** Sidecar d'un WAV, ou null s'il manque ou est illisible (ancien WAV). */
  readMeta(wavPath: string): PendingDictationMeta | null {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.metaPath(wavPath), 'utf8'))
      if (!parsed || typeof parsed.modeId !== 'string') return null
      return parsed as PendingDictationMeta
    } catch {
      return null
    }
  }

  read(filePath: string): Buffer {
    return fs.readFileSync(filePath)
  }

  delete(filePath: string): void {
    for (const target of [filePath, this.metaPath(filePath)]) {
      try {
        fs.unlinkSync(target)
      } catch {
        // Already gone — nothing to do.
      }
    }
  }

  /** Pending WAV files, oldest first. */
  list(): string[] {
    try {
      return fs
        .readdirSync(this.dir)
        .filter(name => name.endsWith('.wav'))
        .sort()
        .map(name => path.join(this.dir, name))
    } catch {
      return []
    }
  }
}

export const pendingDictationStore = new PendingDictationStore()
