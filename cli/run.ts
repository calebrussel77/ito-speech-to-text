import fs from 'node:fs'
import path from 'node:path'
import type { CliOptions } from './args'
import {
  discoverRecordings,
  hasFreshTranscript,
  type Recording,
} from './discover'
import { renderTranscriptMarkdown } from './transcriptMarkdown'
import { getDb, initializeDatabase } from '../lib/main/sqlite/db'
import { initializeStore, type AdvancedSettings } from '../lib/main/store'
import { transcribeExistingFile } from '../lib/main/transcription/fileTranscription'

export type RecordingReport = {
  audio: string
  transcript: string
  status: 'done' | 'skipped' | 'failed'
  speakers?: number
  durationMs?: number
  engine?: string
  error?: string
  seconds?: number
}

const API_KEY_ENV: [keyof AdvancedSettings, string][] = [
  ['openRouterApiKey', 'ITO_OPENROUTER_API_KEY'],
  ['deepgramApiKey', 'ITO_DEEPGRAM_API_KEY'],
  ['openaiApiKey', 'ITO_OPENAI_API_KEY'],
  ['googleApiKey', 'ITO_GOOGLE_API_KEY'],
  ['groqApiKey', 'ITO_GROQ_API_KEY'],
]

/** Les réglages que la ligne de commande impose à ceux d'Ito. */
export function settingsOverrides(
  options: CliOptions,
  env: NodeJS.ProcessEnv = process.env,
): Partial<AdvancedSettings> {
  const overrides: Partial<AdvancedSettings> = {}
  for (const [field, name] of API_KEY_ENV) {
    const value = env[name]?.trim()
    if (value) (overrides as any)[field] = value
  }
  if (options.model) overrides.fileTranscriptionModelKey = options.model
  return overrides
}

const log = (line: string) => process.stderr.write(`${line}\n`)

export async function run(options: CliOptions): Promise<number> {
  const recordings = discoverRecordings(options.inputs, {
    recursive: options.recursive,
    out: options.out,
  })
  if (recordings.length === 0) {
    log('No recordings found.')
    return 0
  }
  if (options.out) fs.mkdirSync(path.resolve(options.out), { recursive: true })

  const reports: RecordingReport[] = recordings.map(recording => ({
    audio: recording.audioPath,
    transcript: recording.transcriptPath,
    status: 'skipped',
  }))
  const todo = recordings
    .map((recording, index) => ({ recording, index }))
    .filter(({ recording }) => options.force || !hasFreshTranscript(recording))

  for (const report of reports) {
    if (!todo.some(({ index }) => reports[index] === report)) {
      log(`skip  ${path.basename(report.audio)} (transcript already there)`)
    }
  }
  log(
    `${todo.length} of ${recordings.length} recording${recordings.length > 1 ? 's' : ''} to transcribe`,
  )
  if (todo.length === 0) return report(reports, options)

  // Le profil Ito n'est ouvert que s'il y a du travail : rien à lire pour
  // dire « déjà fait », et un processus qui sort juste après avoir ouvert
  // SQLite fait planter Bun à la fermeture.
  await initializeDatabase()
  await initializeStore()
  const settings = settingsOverrides(options)

  let next = 0
  const worker = async () => {
    while (next < todo.length) {
      const { recording, index } = todo[next++]
      reports[index] = await transcribeOne(recording, options, settings)
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(options.parallel, todo.length) }, worker),
  )
  await closeDatabase()

  return report(reports, options)
}

/** Fermer proprement avant de sortir : SQLite lâché en plein vol fait planter Bun. */
async function closeDatabase() {
  await new Promise<void>(resolve => {
    try {
      getDb().close(() => resolve())
    } catch {
      resolve()
    }
  })
}

function report(reports: RecordingReport[], options: CliOptions): number {
  const failed = reports.filter(report => report.status === 'failed').length
  if (options.json) {
    process.stdout.write(
      `${JSON.stringify({ recordings: reports }, null, 2)}\n`,
    )
  } else {
    const done = reports.filter(report => report.status === 'done').length
    const skipped = reports.filter(report => report.status === 'skipped').length
    process.stdout.write(
      `${done} transcribed, ${skipped} already there, ${failed} failed\n`,
    )
    for (const report of reports) {
      if (report.status === 'failed') {
        process.stdout.write(`  FAILED ${report.audio}: ${report.error}\n`)
      } else {
        process.stdout.write(`  ${report.transcript}\n`)
      }
    }
  }
  return failed > 0 ? 1 : 0
}

async function transcribeOne(
  recording: Recording,
  options: CliOptions,
  settings: Partial<AdvancedSettings>,
): Promise<RecordingReport> {
  const name = path.basename(recording.audioPath)
  const startedAt = performance.now()
  log(`start ${name}`)
  const base: RecordingReport = {
    audio: recording.audioPath,
    transcript: recording.transcriptPath,
    status: 'failed',
  }
  try {
    const result = await transcribeExistingFile(recording.audioPath, {
      settings,
      language: options.language,
      history: options.history,
    })
    const seconds = Math.round((performance.now() - startedAt) / 1000)
    if (!result.ok || result.text === undefined) {
      log(`fail  ${name}: ${result.error}`)
      return { ...base, error: result.error ?? 'Transcription failed', seconds }
    }
    const markdown = renderTranscriptMarkdown({
      audioPath: recording.audioPath,
      recordedAt: fs.statSync(recording.audioPath).mtime,
      durationMs: result.durationMs,
      speakerCount: result.speakerCount ?? 0,
      engine: result.engine ?? 'unknown',
      language: options.language,
      text: result.text,
      segments: result.segments ?? [],
    })
    fs.writeFileSync(recording.transcriptPath, markdown, 'utf8')
    log(
      `done  ${name} in ${seconds} s — ${
        (result.speakerCount ?? 0) >= 2
          ? `${result.speakerCount} speakers`
          : 'single speaker'
      }`,
    )
    return {
      ...base,
      status: 'done',
      speakers: result.speakerCount,
      durationMs: result.durationMs,
      engine: result.engine,
      seconds,
    }
  } catch (error: any) {
    const seconds = Math.round((performance.now() - startedAt) / 1000)
    log(`fail  ${name}: ${error?.message ?? error}`)
    return { ...base, error: error?.message ?? String(error), seconds }
  }
}
