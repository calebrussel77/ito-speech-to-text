import fs from 'node:fs'
import path from 'node:path'

const GROQ = process.env.GROQ_KEY
const OR = process.env.OR_KEY
const DIR = path.dirname(new URL(import.meta.url).pathname.slice(1))
const ATTEMPTS = 3

const CONTEXT_PROMPT =
  "Dictée technique d'un développeur francophone. Français courant avec termes anglais de programmation (code-switching FR/EN)."

// 16 kHz mono WAV — exactly what LocalAudioProcessor hands the pipeline, so
// the benchmark measures the request the app actually makes.
const CLIPS = [
  { id: 'code', file: `${DIR}/enregistrement-code.wav`, seconds: 78.63 },
  {
    id: 'feature',
    file: `${DIR}/enregistrement-feature-ito.wav`,
    seconds: 149.21,
  },
]

const MODELS = [
  { key: 'whisper-large-v3', slug: 'whisper-large-v3', provider: 'groq' },
  {
    key: 'whisper-large-v3-turbo',
    slug: 'whisper-large-v3-turbo',
    provider: 'groq',
  },
  { key: 'gpt-transcribe', slug: 'openai/gpt-transcribe', provider: 'or' },
  {
    key: 'voxtral-mini-transcribe',
    slug: 'mistralai/voxtral-mini-transcribe',
    provider: 'or',
  },
  { key: 'nova-3', slug: 'deepgram/nova-3', provider: 'or' },
  { key: 'chirp-3', slug: 'google/chirp-3', provider: 'or' },
  {
    key: 'qwen3-asr-flash',
    slug: 'qwen/qwen3-asr-flash-2026-02-10',
    provider: 'or',
  },
  {
    key: 'whisper-large-v3-turbo-openrouter',
    slug: 'openai/whisper-large-v3-turbo',
    provider: 'or',
  },
  {
    key: 'voxtral-small-stt',
    slug: 'mistralai/voxtral-small-24b-2507-stt',
    provider: 'or',
  },
  { key: 'gpt-4o-transcribe', slug: 'openai/gpt-4o-transcribe', provider: 'or' },
]

async function runGroq(slug, buf) {
  const form = new FormData()
  form.append('file', new Blob([buf]), 'audio.wav')
  form.append('model', slug)
  form.append('language', 'fr')
  form.append('prompt', CONTEXT_PROMPT)
  form.append('response_format', 'verbose_json')
  form.append('temperature', '0')

  const res = await fetch(
    'https://api.groq.com/openai/v1/audio/transcriptions',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${GROQ}` },
      body: form,
      signal: AbortSignal.timeout(300_000),
    },
  )
  if (!res.ok)
    throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`)
  const json = await res.json()
  return { text: (json.text || '').trim(), cost: null }
}

// Same body shaping as lib/main/transcription/OpenRouterTranscriptionService.ts
function orBody(slug, b64) {
  const body = {
    model: slug,
    input_audio: { data: b64, format: 'wav' },
    temperature: 0,
    response_format: 'json',
  }
  if (slug.includes('gpt-transcribe')) {
    body.provider = {
      options: { openai: { prompt: CONTEXT_PROMPT, languages: ['fr', 'en'] } },
    }
  } else {
    body.language = 'fr'
  }
  return body
}

async function runOR(slug, buf) {
  const body = JSON.stringify(orBody(slug, buf.toString('base64')))
  const res = await fetch(
    'https://openrouter.ai/api/v1/audio/transcriptions',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OR}`,
        'Content-Type': 'application/json',
        // Without this Node streams the body chunked, which OpenRouter's edge
        // rejects at this size — it surfaces as an opaque "fetch failed".
        'Content-Length': Buffer.byteLength(body).toString(),
      },
      body,
      signal: AbortSignal.timeout(300_000),
    },
  )
  if (!res.ok)
    throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`)
  const json = await res.json()
  return { text: (json.text || '').trim(), cost: json.usage?.cost ?? null }
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

/** Retries transport failures and 5xx; a 4xx is the model's real answer. */
async function withRetry(fn) {
  let last
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const t0 = Date.now()
    try {
      const r = await fn()
      return { ...r, latency: (Date.now() - t0) / 1000, attempts: attempt }
    } catch (e) {
      last = e
      const msg = String(e.message)
      const permanent = /HTTP 4\d\d/.test(msg)
      if (permanent || attempt === ATTEMPTS) break
      await sleep(2000 * attempt)
    }
  }
  throw last
}

const results = []
for (const clip of CLIPS) {
  const buf = fs.readFileSync(clip.file)
  console.log(`\n--- ${clip.id} (${clip.seconds}s audio) ---`)
  for (const model of MODELS) {
    await sleep(1500)
    try {
      const r = await withRetry(() =>
        model.provider === 'groq'
          ? runGroq(model.slug, buf)
          : runOR(model.slug, buf),
      )
      results.push({
        clip: clip.id,
        seconds: clip.seconds,
        ...model,
        ...r,
        error: null,
      })
      console.log(
        `${model.key.padEnd(34)} ${r.latency.toFixed(1)}s  rtf=${(clip.seconds / r.latency).toFixed(1)}x  ${String(r.text.length).padStart(5)} chars  try=${r.attempts}`,
      )
    } catch (e) {
      results.push({
        clip: clip.id,
        seconds: clip.seconds,
        ...model,
        latency: null,
        text: '',
        cost: null,
        error: String(e.message).slice(0, 200),
      })
      console.log(
        `${model.key.padEnd(34)} ERROR ${String(e.message).slice(0, 110)}`,
      )
    }
  }
}

fs.writeFileSync(
  path.join(DIR, 'voice-results.json'),
  JSON.stringify(results, null, 2),
)
console.log('\nwrote voice-results.json')
