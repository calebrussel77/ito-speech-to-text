import fs from 'node:fs'
import path from 'node:path'

/**
 * Mesure des quatre modèles OpenAI servis en direct (2026-08-15), dans le
 * même protocole que voice.mjs : mêmes WAV 16 kHz mono, mêmes hints que le
 * run du 2026-08-14 (prompt + languages pour gpt-transcribe, language seul
 * pour la famille 4o — c'est ce que le run OpenRouter leur donnait), même
 * convention de latence. Les lignes s'ajoutent à voice-results.json, puis
 * `node wer.mjs` recalcule le tableau complet.
 */

const KEY = process.env.OPENAI_KEY
if (!KEY) throw new Error('OPENAI_KEY missing')
const DIR = path.dirname(new URL(import.meta.url).pathname.slice(1))
const ATTEMPTS = 3

const CONTEXT_PROMPT =
  "Dictée technique d'un développeur francophone. Français courant avec termes anglais de programmation (code-switching FR/EN)."

const CLIPS = [
  { id: 'code', file: `${DIR}/enregistrement-code.wav`, seconds: 78.63 },
  {
    id: 'feature',
    file: `${DIR}/enregistrement-feature-ito.wav`,
    seconds: 149.21,
  },
]

const MODELS = [
  { key: 'gpt-transcribe-openai', slug: 'gpt-transcribe' },
  { key: 'gpt-4o-transcribe-openai', slug: 'gpt-4o-transcribe' },
  {
    key: 'gpt-4o-mini-transcribe-openai',
    slug: 'gpt-4o-mini-transcribe-2025-12-15',
  },
  {
    key: 'gpt-4o-transcribe-diarize-openai',
    slug: 'gpt-4o-transcribe-diarize',
    diarize: true,
  },
]

async function run(model, buf) {
  const form = new FormData()
  form.append('file', new Blob([buf]), 'audio.wav')
  form.append('model', model.slug)
  if (model.diarize) {
    // Le modèle Diarize ne prend ni prompt ni temperature ; le chunking est
    // obligatoire au-delà de 30 s.
    form.append('language', 'fr')
    form.append('response_format', 'diarized_json')
    form.append('chunking_strategy', 'auto')
  } else if (model.slug.startsWith('gpt-transcribe')) {
    form.append('prompt', CONTEXT_PROMPT)
    form.append('languages[]', 'fr')
    form.append('languages[]', 'en')
    form.append('temperature', '0')
  } else {
    form.append('language', 'fr')
    form.append('temperature', '0')
  }

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}` },
    body: form,
    signal: AbortSignal.timeout(300_000),
  })
  if (!res.ok)
    throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`)
  const json = await res.json()
  return { text: (json.text || '').trim(), cost: null }
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

const resultsPath = path.join(DIR, 'voice-results.json')
const previous = JSON.parse(fs.readFileSync(resultsPath, 'utf8')).filter(
  r => !MODELS.some(m => m.key === r.key),
)

const results = []
for (const clip of CLIPS) {
  const buf = fs.readFileSync(clip.file)
  console.log(`\n--- ${clip.id} (${clip.seconds}s audio) ---`)
  for (const model of MODELS) {
    await sleep(1500)
    try {
      const r = await withRetry(() => run(model, buf))
      results.push({
        clip: clip.id,
        seconds: clip.seconds,
        key: model.key,
        slug: model.slug,
        provider: 'openai',
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
        key: model.key,
        slug: model.slug,
        provider: 'openai',
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

fs.writeFileSync(resultsPath, JSON.stringify([...previous, ...results], null, 2))
console.log('\nappended to voice-results.json')
