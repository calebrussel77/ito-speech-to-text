import { parseArgs } from 'node:util'

export type CliOptions = {
  inputs: string[]
  out?: string
  recursive: boolean
  force: boolean
  model?: string
  language?: string
  parallel: number
  json: boolean
  history: boolean
  env: 'prod' | 'local'
  help: boolean
}

export const HELP = `ito-transcribe — transcribe recordings (calls, meetings) with Ito's engines

Usage:
  ito-transcribe <folder | file>... [options]

Writes one Markdown transcript next to each recording (name.transcript.md):
a header (file, recorded at, duration, speakers, engine) then the dialogue,
one line per turn with timestamps and speakers. Dictations vs. conversations
are detected from the audio. Recordings that already have a transcript are
skipped; pass --force to redo them.

Options:
  --out <dir>        Write transcripts into this folder instead of next to the audio
  --recursive        Also look into sub-folders
  --force            Transcribe again even when a transcript exists
  --model <key>      Model key from Ito's catalog (default: the "Imported file
                     transcription" setting in Ito). Examples: nova-3,
                     gemini-3-7-flash-openrouter-audio, gpt-transcribe-openai
  --language <code>  Spoken language, e.g. fr, en (default: Ito's active mode)
  --parallel <n>     Recordings transcribed at once (default: 2)
  --json             Print a JSON report on stdout instead of the summary
  --no-history       Keep the transcript out of Ito's history
  --env <prod|local> Which Ito profile to read (default: prod)
  -h, --help         Show this help

Environment:
  ITO_OPENROUTER_API_KEY, ITO_DEEPGRAM_API_KEY, ITO_OPENAI_API_KEY,
  ITO_GOOGLE_API_KEY, ITO_GROQ_API_KEY override the keys stored in Ito.

Accepted formats: m4a, mp3, wav, ogg, opus, webm, mp4, aac, flac, wma, mkv
(anything but wav needs ffmpeg on PATH).

Exit codes: 0 all done, 1 at least one recording failed, 2 bad usage.
`

export function parseCliArgs(argv: string[]): CliOptions {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    allowNegative: true,
    options: {
      out: { type: 'string' },
      recursive: { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      model: { type: 'string' },
      language: { type: 'string' },
      parallel: { type: 'string', default: '2' },
      json: { type: 'boolean', default: false },
      history: { type: 'boolean', default: true },
      env: { type: 'string', default: 'prod' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  })

  const parallel = Number.parseInt(values.parallel ?? '2', 10)
  if (!Number.isFinite(parallel) || parallel < 1) {
    throw new Error('--parallel must be a positive integer')
  }
  if (values.env !== 'prod' && values.env !== 'local') {
    throw new Error('--env must be prod or local')
  }

  return {
    inputs: positionals,
    out: values.out,
    recursive: values.recursive ?? false,
    force: values.force ?? false,
    model: values.model,
    language: values.language,
    parallel,
    json: values.json ?? false,
    history: values.history ?? true,
    env: values.env,
    help: values.help ?? false,
  }
}
