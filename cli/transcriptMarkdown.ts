import path from 'node:path'
import type { SpeakerSegment } from '../lib/main/transcription/DeepgramTranscriptionService'

export type TranscriptDocument = {
  audioPath: string
  recordedAt: Date
  durationMs?: number
  speakerCount: number
  engine: string
  language?: string
  text: string
  segments: SpeakerSegment[]
}

const pad = (n: number) => String(n).padStart(2, '0')

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60000)
  if (minutes < 1) return `${Math.round(ms / 1000)} s`
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h ${pad(minutes % 60)}`
}

function formatDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * Le transcript tel qu'un agent le lit : un en-tête qui le rattache au bon
 * appel, puis le contenu. Une conversation donne une ligne par tour,
 * horodatée et attribuée ; un monologue, le texte en paragraphes.
 */
export function renderTranscriptMarkdown(doc: TranscriptDocument): string {
  const lines: string[] = [
    `# ${path.basename(doc.audioPath)}`,
    '',
    `- File: ${doc.audioPath}`,
    `- Recorded: ${formatDate(doc.recordedAt)}`,
  ]
  if (doc.durationMs && doc.durationMs > 0) {
    lines.push(`- Duration: ${formatDuration(doc.durationMs)}`)
  }
  lines.push(
    `- Speakers: ${doc.speakerCount >= 2 ? doc.speakerCount : '1 (monologue)'}`,
  )
  if (doc.language) lines.push(`- Language: ${doc.language}`)
  lines.push(`- Engine: ${doc.engine}`, '', '## Transcript', '')

  if (doc.speakerCount >= 2 && doc.segments.length > 0) {
    for (const segment of doc.segments) {
      lines.push(
        `**[${formatClock(segment.startMs)}] ${segment.label}:** ${segment.text}`,
        '',
      )
    }
  } else {
    lines.push(doc.text.trim(), '')
  }
  return lines.join('\n')
}
