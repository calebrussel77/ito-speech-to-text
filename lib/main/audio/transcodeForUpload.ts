import { execFile, spawn } from 'child_process'
import { wavToMp3 } from './wavToMp3'

/**
 * Ce qu'un fournisseur reçoit pour un fichier importé : l'original, ou une
 * version mono 16 kHz à 48 kbit/s en MP3 quand ça vaut la peine.
 *
 * Un enregistrement de réunion pèse vite trop lourd pour être envoyé tel
 * quel : 45 Mo de m4a stéréo pour 46 minutes, au-dessus des 25 Mo d'OpenAI
 * et long à pousser partout ailleurs, alors que la même parole en mono à
 * 48 kbit/s tient en 17 Mo pour un transcript identique. Le WAV passe par
 * le worker MP3 de l'app ; tout autre conteneur (m4a, mp4, ogg, webm, flac)
 * demande un décodeur, et c'est ffmpeg quand la machine en a un. Sans
 * ffmpeg, l'original part tel quel : la compression accélère, elle ne
 * conditionne rien.
 */

export type UploadAudio = {
  bytes: Buffer
  contentType: string
  fileName: string
  /** L'original a été réencodé (pour la ligne d'historique et les logs). */
  transcoded: boolean
}

const CONTENT_TYPES: Record<string, string> = {
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  mp4: 'video/mp4',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  webm: 'audio/webm',
}

export function contentTypeFor(filePath: string): string {
  const extension = filePath.split('.').pop()?.toLowerCase() ?? ''
  return CONTENT_TYPES[extension] ?? 'audio/wav'
}

/** Un MP3 déjà léger n'a rien à gagner à repasser par ffmpeg. */
const MP3_KEEP_BELOW_BYTES = 20 * 1024 * 1024
/** Dix minutes de conversion, au-delà on renonce et on envoie l'original. */
const FFMPEG_TIMEOUT_MS = 10 * 60 * 1000

let ffmpegPath: string | null | undefined

/** Le binaire ffmpeg sur le PATH, mémorisé ; null quand il n'y en a pas. */
export async function findFfmpeg(): Promise<string | null> {
  if (ffmpegPath !== undefined) return ffmpegPath
  ffmpegPath = await new Promise<string | null>(resolve => {
    execFile('ffmpeg', ['-version'], { windowsHide: true }, error =>
      resolve(error ? null : 'ffmpeg'),
    )
  })
  return ffmpegPath
}

/** Pour les tests : oublie le résultat de la détection. */
export function resetFfmpegDetection(): void {
  ffmpegPath = undefined
}

/**
 * Décode n'importe quel conteneur avec ffmpeg et rend un MP3 mono 16 kHz à
 * 48 kbit/s, lu sur stdout sans fichier temporaire. Rend null sur toute
 * défaillance : binaire absent, format inconnu, délai dépassé.
 */
export async function transcodeWithFfmpeg(
  filePath: string,
  ffmpeg: string,
): Promise<Buffer | null> {
  return new Promise(resolve => {
    const chunks: Buffer[] = []
    let settled = false
    const done = (result: Buffer | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const child = spawn(
      ffmpeg,
      [
        '-v',
        'error',
        '-i',
        filePath,
        '-vn',
        '-ac',
        '1',
        '-ar',
        '16000',
        '-b:a',
        '48k',
        '-f',
        'mp3',
        'pipe:1',
      ],
      { windowsHide: true },
    )
    const timer = setTimeout(() => {
      child.kill()
      console.warn('[transcodeForUpload] ffmpeg timed out')
      done(null)
    }, FFMPEG_TIMEOUT_MS)
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.stderr.on('data', (chunk: Buffer) =>
      console.warn('[transcodeForUpload] ffmpeg:', String(chunk).trim()),
    )
    child.on('error', error => {
      console.warn('[transcodeForUpload] ffmpeg failed to start:', error)
      done(null)
    })
    child.on('close', code => {
      if (code !== 0 || chunks.length === 0) return done(null)
      done(Buffer.concat(chunks))
    })
  })
}

export async function prepareUploadAudio(
  filePath: string,
  original: Buffer,
): Promise<UploadAudio> {
  const fileName = filePath.split(/[\\/]/).pop() || 'recording'
  const contentType = contentTypeFor(filePath)
  const asIs: UploadAudio = {
    bytes: original,
    contentType,
    fileName,
    transcoded: false,
  }
  const mp3Name = fileName.replace(/\.[^.]+$/, '') + '.mp3'

  if (contentType === 'audio/wav') {
    const mp3 = await wavToMp3(original)
    return mp3
      ? {
          bytes: mp3,
          contentType: 'audio/mpeg',
          fileName: mp3Name,
          transcoded: true,
        }
      : asIs
  }
  if (contentType === 'audio/mpeg' && original.length < MP3_KEEP_BELOW_BYTES) {
    return asIs
  }
  const ffmpeg = await findFfmpeg()
  if (!ffmpeg) return asIs
  const mp3 = await transcodeWithFfmpeg(filePath, ffmpeg)
  if (!mp3 || mp3.length >= original.length) return asIs
  return {
    bytes: mp3,
    contentType: 'audio/mpeg',
    fileName: mp3Name,
    transcoded: true,
  }
}
