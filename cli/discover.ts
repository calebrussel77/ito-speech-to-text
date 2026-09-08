import fs from 'node:fs'
import path from 'node:path'

export const AUDIO_EXTENSIONS = new Set([
  '.m4a',
  '.mp3',
  '.wav',
  '.ogg',
  '.opus',
  '.webm',
  '.mp4',
  '.aac',
  '.flac',
  '.wma',
  '.mkv',
])

export const TRANSCRIPT_SUFFIX = '.transcript.md'

export type Recording = {
  audioPath: string
  transcriptPath: string
}

/**
 * Les enregistrements désignés par les arguments : chaque fichier tel quel,
 * chaque dossier parcouru (un niveau, ou tout l'arbre avec `recursive`),
 * dans l'ordre alphabétique pour que la matinée se lise dans l'ordre.
 * Un chemin absent est une erreur, pas un silence.
 */
export function discoverRecordings(
  inputs: string[],
  options: { recursive: boolean; out?: string },
): Recording[] {
  const found: string[] = []
  for (const input of inputs) {
    const resolved = path.resolve(input)
    if (!fs.existsSync(resolved)) {
      throw new Error(`Not found: ${resolved}`)
    }
    const stat = fs.statSync(resolved)
    if (stat.isDirectory()) {
      found.push(...listAudio(resolved, options.recursive))
    } else if (isAudio(resolved)) {
      found.push(resolved)
    } else {
      throw new Error(`Not a recording: ${resolved}`)
    }
  }
  const unique = [...new Set(found)]
  return unique.map(audioPath => ({
    audioPath,
    transcriptPath: transcriptPathFor(audioPath, options.out),
  }))
}

function isAudio(filePath: string): boolean {
  return AUDIO_EXTENSIONS.has(path.extname(filePath).toLowerCase())
}

function listAudio(dir: string, recursive: boolean): string[] {
  const entries = fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
  const files: string[] = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (recursive) files.push(...listAudio(full, true))
    } else if (isAudio(full)) {
      files.push(full)
    }
  }
  return files
}

export function transcriptPathFor(audioPath: string, out?: string): string {
  const base = path.basename(audioPath, path.extname(audioPath))
  const dir = out ? path.resolve(out) : path.dirname(audioPath)
  return path.join(dir, `${base}${TRANSCRIPT_SUFFIX}`)
}

/** Un transcript plus récent que son audio vaut déjà : rien à refaire. */
export function hasFreshTranscript(recording: Recording): boolean {
  if (!fs.existsSync(recording.transcriptPath)) return false
  const audio = fs.statSync(recording.audioPath)
  const transcript = fs.statSync(recording.transcriptPath)
  return transcript.mtimeMs >= audio.mtimeMs
}
