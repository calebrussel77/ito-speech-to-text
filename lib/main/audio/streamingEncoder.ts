import type { Worker } from 'node:worker_threads'
import createWorker from './mp3EncoderWorker?nodeWorker'

/** 48 kbit/s mono : ~5× plus léger que le WAV, transparent pour un moteur vocal. */
const MP3_KBPS = 48
/** Au-delà, l'encodeur est considéré bloqué et la dictée part en WAV. */
const FINISH_TIMEOUT_MS = 3000

/**
 * Encodage MP3 au fil de l'eau, dans un worker, pendant l'enregistrement.
 *
 * Le WAV d'une dictée de 54 s pèse 1,7 Mo ; sur une liaison montante
 * lente, l'upload dominait la latence. Encoder pendant qu'on parle rend le
 * fichier compressé prêt au relâchement du raccourci, pour une fraction du
 * poids. Toute défaillance — worker absent, erreur, délai — se solde par
 * `null` et le chemin WAV reprend : la compression est une accélération,
 * jamais une condition.
 */
export class StreamingMp3Encoder {
  private worker: Worker | null = null
  private failed = false
  private done: Promise<Buffer | null> | null = null
  private settle: ((result: Buffer | null) => void) | null = null

  start(sampleRate: number): void {
    try {
      this.worker = createWorker({})
      this.worker.on('error', error => this.fail(error))
      this.worker.on('exit', code => {
        if (code !== 0 && !this.done) this.fail(new Error(`exit ${code}`))
      })
      // Écouté dès le départ : une erreur au démarrage du worker (module
      // absent, par exemple) arrive bien avant `finish`, et doit dès lors
      // basculer la dictée sur le WAV plutôt que d'être perdue.
      this.worker.on('message', (message: any) => {
        if (message?.type === 'done') {
          const mp3 = Buffer.from(message.mp3 as ArrayBuffer)
          this.settle?.(mp3.length > 0 ? mp3 : null)
        } else if (message?.type === 'error') {
          console.warn('[StreamingMp3Encoder] worker error:', message.message)
          if (this.settle) this.settle(null)
          else this.fail(new Error(message.message))
        }
      })
      this.worker.postMessage({ type: 'start', sampleRate, kbps: MP3_KBPS })
    } catch (error) {
      this.fail(error)
    }
  }

  push(chunk: Buffer): void {
    if (!this.worker || this.failed) return
    // Copie : le worker devient propriétaire du buffer transféré, alors que
    // l'appelant garde le sien pour le WAV de secours.
    const pcm = new ArrayBuffer(chunk.byteLength - (chunk.byteLength % 2))
    new Uint8Array(pcm).set(chunk.subarray(0, pcm.byteLength))
    try {
      this.worker.postMessage({ type: 'chunk', pcm }, [pcm])
    } catch (error) {
      this.fail(error)
    }
  }

  /** Le MP3 complet, ou `null` si l'encodage a échoué en route. */
  finish(): Promise<Buffer | null> {
    if (this.done) return this.done
    const worker = this.worker
    if (!worker || this.failed) {
      this.terminate()
      return Promise.resolve(null)
    }
    this.done = new Promise<Buffer | null>(resolve => {
      const timeout = setTimeout(() => {
        console.warn('[StreamingMp3Encoder] finish timed out, using WAV')
        settle(null)
      }, FINISH_TIMEOUT_MS)
      const settle = (result: Buffer | null) => {
        clearTimeout(timeout)
        this.settle = null
        this.terminate()
        resolve(result)
      }
      this.settle = settle
      worker.once('error', () => settle(null))
      try {
        worker.postMessage({ type: 'finish' })
      } catch {
        settle(null)
      }
    })
    return this.done
  }

  abort(): void {
    this.terminate()
  }

  private fail(error: unknown) {
    if (!this.failed) {
      console.warn('[StreamingMp3Encoder] disabled for this dictation:', error)
    }
    this.failed = true
    this.terminate()
  }

  private terminate() {
    const worker = this.worker
    this.worker = null
    worker?.terminate().catch(() => {})
  }
}

export function createStreamingEncoder(): StreamingMp3Encoder {
  return new StreamingMp3Encoder()
}
