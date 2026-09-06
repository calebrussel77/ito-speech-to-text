import { parentPort } from 'node:worker_threads'
import { Mp3Encoder } from '@breezystack/lamejs'

/**
 * Encode la dictée en MP3 au fil de l'eau, pendant l'enregistrement, dans
 * un thread à part. À la fin, il ne reste que la dernière trame à vider :
 * le fichier compressé est prêt quelques millisecondes après le relâchement
 * du raccourci, sans que le processus principal ait travaillé.
 *
 * Le filtre passe-haut à 80 Hz est le même que celui du chemin WAV
 * (`LocalAudioProcessor.enhancePcm16`) ; il est appliqué en continu, état
 * conservé d'un bloc à l'autre. La normalisation de gain, elle, a besoin
 * du pic global et ne peut pas être appliquée à des trames déjà encodées :
 * les moteurs vocaux normalisent de toute façon leur entrée.
 */

type InMessage =
  | { type: 'start'; sampleRate: number; kbps: number }
  | { type: 'chunk'; pcm: ArrayBuffer }
  | { type: 'finish' }

const BLOCK_SAMPLES = 1152 * 8

let encoder: Mp3Encoder | null = null
let parts: Uint8Array[] = []
let total = 0
let filterA = 0
let prevX = 0
let prevY = 0
/** Première erreur rencontrée : elle invalide toute la dictée en cours. */
let failure: string | null = null

function reset(sampleRate: number, kbps: number) {
  failure = null
  encoder = new Mp3Encoder(1, sampleRate, kbps)
  if (typeof encoder.encodeBuffer !== 'function') {
    throw new Error('Mp3Encoder unavailable in this build')
  }
  parts = []
  total = 0
  filterA = Math.exp((-2 * Math.PI * 80) / sampleRate)
  prevX = 0
  prevY = 0
}

function pushPart(part: Uint8Array) {
  if (part.length === 0) return
  parts.push(part)
  total += part.length
}

function encodeChunk(buffer: ArrayBuffer) {
  if (!encoder) return
  const samples = new Int16Array(buffer, 0, Math.floor(buffer.byteLength / 2))
  const filtered = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i]
    const y = filterA * (prevY + x - prevX)
    prevX = x
    prevY = y
    const v = Math.round(y)
    filtered[i] = v > 32767 ? 32767 : v < -32768 ? -32768 : v
  }
  for (let i = 0; i < filtered.length; i += BLOCK_SAMPLES) {
    pushPart(
      encoder.encodeBuffer(
        filtered.subarray(i, Math.min(i + BLOCK_SAMPLES, filtered.length)),
      ),
    )
  }
}

function finish(): Uint8Array<ArrayBuffer> {
  if (!encoder) return new Uint8Array(new ArrayBuffer(0))
  pushPart(encoder.flush())
  const out = new Uint8Array(new ArrayBuffer(total))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  encoder = null
  parts = []
  total = 0
  return out
}

parentPort?.on('message', (message: InMessage) => {
  try {
    if (message.type === 'start') {
      reset(message.sampleRate, message.kbps)
    } else if (message.type === 'chunk') {
      if (!failure) encodeChunk(message.pcm)
    } else if (message.type === 'finish') {
      // Une erreur survenue avant que le processus principal n'écoute (au
      // démarrage, typiquement) ne doit jamais se solder par un fichier
      // vide envoyé à un moteur : c'est la reprise en WAV qui prend.
      if (failure) throw new Error(failure)
      const mp3 = finish()
      if (mp3.byteLength === 0) throw new Error('encoder produced no audio')
      parentPort?.postMessage({ type: 'done', mp3: mp3.buffer }, [mp3.buffer])
    }
  } catch (error: any) {
    failure = error?.message || String(error)
    parentPort?.postMessage({ type: 'error', message: failure })
  }
})
