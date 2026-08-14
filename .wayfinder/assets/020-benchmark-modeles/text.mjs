import fs from 'node:fs'
import path from 'node:path'

const GROQ = process.env.GROQ_KEY
const OR = process.env.OR_KEY
const OUTDIR = path.dirname(new URL(import.meta.url).pathname.slice(1))
const REPS = 3

// Mirrors TEXT_MODELS in lib/constants/modelCatalog.ts
const MODELS = [
  { key: 'gpt-oss-20b-groq', slug: 'openai/gpt-oss-20b', provider: 'groq' },
  { key: 'gpt-oss-120b-groq', slug: 'openai/gpt-oss-120b', provider: 'groq' },
  { key: 'qwen3-27b-groq', slug: 'qwen/qwen3.6-27b', provider: 'groq' },
  {
    key: 'gpt-oss-120b-cerebras',
    slug: 'openai/gpt-oss-120b',
    provider: 'or',
    pin: 'Cerebras',
  },
  {
    key: 'gemma-4-31b-cerebras',
    slug: 'google/gemma-4-31b-it',
    provider: 'or',
    pin: 'Cerebras',
  },
  { key: 'mistral-nemo', slug: 'mistralai/mistral-nemo', provider: 'or' },
  { key: 'qwen3-flash', slug: 'qwen/qwen3.7-flash', provider: 'or' },
  { key: 'glm-4-7-flash', slug: 'z-ai/glm-4.7-flash', provider: 'or' },
  { key: 'gpt-5-6-luna', slug: 'openai/gpt-5.6-luna', provider: 'or' },
  {
    key: 'gemini-2-5-flash-lite',
    slug: 'google/gemini-2.5-flash-lite',
    provider: 'or',
  },
  { key: 'gpt-5-4-nano', slug: 'openai/gpt-5.4-nano', provider: 'or' },
  {
    key: 'gemini-3-5-flash-lite',
    slug: 'google/gemini-3.5-flash-lite',
    provider: 'or',
  },
  { key: 'gemini-3-7-flash', slug: 'google/gemini-3.7-flash', provider: 'or' },
  {
    key: 'claude-haiku-4-5',
    slug: 'anthropic/claude-haiku-4.5',
    provider: 'or',
  },
  { key: 'claude-sonnet-5', slug: 'anthropic/claude-sonnet-5', provider: 'or' },
]

// The app's real Intelligent Mode prompt (shared-constants.js) and a real
// dictation from the bake-off assets: measuring on the actual workload rather
// than a synthetic one.
const EDITING_PROMPT = `You are in EDIT mode. Use the provided context (window title, app name, and selected text) to adjust the transcript. Keep the user's intent and be concise.
 You are a Command-Interpreter assistant. Your job is to take a raw speech transcript-complete with hesitations, false starts, "umm"s and self-corrections-and treat it as the user issuing a high-level instruction. Instead of merely polishing their words, you must:
    1. Extract the intent: identify the action the user is asking for.
    2. Ignore disfluencies: strip out "uh," "um," false starts and filler.
    3. Map to a template: choose an appropriate standard format.
    4. Generate the deliverable: produce a fully-formed document in that format.
    5. Do not add new intent.
    6. Produce only the final document: no commentary.`

const TRANSCRIPT = `Hey Claude, j'aimerais que tu modifies le fichier agent.md et que tu ajustes le fichier transcription.tsx pour qu'il puisse prendre en compte la nouvelle architecture sur laquelle je travaille. Bien évidemment, il faudrait que le code soit suffisamment précis, que ce soit du clean code, du code solide et qui utilise les best practices d'ingénierie et de programming. Donc l'idée est vraiment de pouvoir être sûr que l'application soit suffisamment scalable, maintenable sur le long terme. Maintenant, je vais ouvrir Cursor pour voir un petit peu effectivement à quel niveau où le code se trouve et voir aussi si c'est possible de pouvoir modifier certaines parties qui avaient été faites par les modèles précédents qui étaient beaucoup moins intelligents à l'époque.`

const MESSAGES = [
  { role: 'system', content: EDITING_PROMPT },
  {
    role: 'user',
    content: `Transcript:\n${TRANSCRIPT}\n\nContext:\nWindow: agent.md | App: Cursor`,
  },
]

async function call(model) {
  const isGroq = model.provider === 'groq'
  const url = isGroq
    ? 'https://api.groq.com/openai/v1/chat/completions'
    : 'https://openrouter.ai/api/v1/chat/completions'
  const payload = {
    model: model.slug,
    messages: MESSAGES,
    temperature: 0.1,
    max_tokens: 900,
  }
  if (model.pin) {
    payload.provider = { order: [model.pin], allow_fallbacks: false }
  }
  const body = JSON.stringify(payload)

  const t0 = Date.now()
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${isGroq ? GROQ : OR}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body).toString(),
    },
    body,
    signal: AbortSignal.timeout(180_000),
  })
  const elapsed = (Date.now() - t0) / 1000
  if (!res.ok)
    throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`)
  const json = await res.json()
  const completion = json.usage?.completion_tokens ?? null
  return {
    elapsed,
    completionTokens: completion,
    tps: completion ? completion / elapsed : null,
    servedBy: json.provider ?? (isGroq ? 'Groq' : null),
    text: json.choices?.[0]?.message?.content ?? '',
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []

/** Retries transport failures and 429/5xx; other 4xx is a real answer. */
async function callWithRetry(model) {
  let last
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await call(model)
    } catch (e) {
      last = e
      const msg = String(e.message)
      const permanent = /HTTP 4\d\d/.test(msg) && !/HTTP 429/.test(msg)
      if (permanent || attempt === 3) break
      await sleep(3000 * attempt)
    }
  }
  throw last
}

for (const model of MODELS) {
  const runs = []
  for (let i = 0; i < REPS; i++) {
    await sleep(1200)
    try {
      runs.push(await callWithRetry(model))
    } catch (e) {
      runs.push({ error: String(e.message).slice(0, 160) })
    }
  }
  const ok = runs.filter(r => r.tps)
  const tpsValues = ok.map(r => r.tps).sort((a, b) => a - b)
  const median = tpsValues.length
    ? tpsValues[Math.floor(tpsValues.length / 2)]
    : null
  results.push({
    ...model,
    runs,
    medianTps: median,
    servedBy: ok[0]?.servedBy ?? null,
    sample: ok[0]?.text?.slice(0, 400) ?? runs[0]?.error ?? '',
  })
  console.log(
    `${model.key.padEnd(24)} ${median ? median.toFixed(0).padStart(5) + ' tok/s' : '  FAILED'}  served=${ok[0]?.servedBy ?? '-'}  runs=${ok.length}/${REPS}`,
  )
}

fs.writeFileSync(
  path.join(OUTDIR, 'text-results.json'),
  JSON.stringify(results, null, 2),
)
console.log('\nwrote text-results.json')
