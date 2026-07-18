import { app } from 'electron'
import fs from 'fs'
import path from 'path'

/**
 * Disk-backed holding area for dictation audio. A WAV is written here BEFORE
 * the transcription network call and deleted after success, so a network
 * failure, an API outage or an app crash can never lose a dictation: the
 * audio survives on disk and is recovered later.
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

  save(wavAudio: Buffer): string {
    this.ensureDir()
    const sequence = (this.sequence++).toString().padStart(4, '0')
    const fileName = `dictation-${Date.now()}-${sequence}.wav`
    const filePath = path.join(this.dir, fileName)
    fs.writeFileSync(filePath, wavAudio)
    return filePath
  }

  read(filePath: string): Buffer {
    return fs.readFileSync(filePath)
  }

  delete(filePath: string): void {
    try {
      fs.unlinkSync(filePath)
    } catch {
      // Already gone — nothing to do.
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
