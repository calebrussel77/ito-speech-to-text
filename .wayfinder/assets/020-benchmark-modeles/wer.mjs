import fs from 'node:fs'
import path from 'node:path'

const DIR = path.dirname(new URL(import.meta.url).pathname.slice(1))

/**
 * Reference transcripts.
 *
 * Source: the `openai/gpt-transcribe` output of the 2026-08-07 blind bake-off
 * (.wayfinder/assets/015-bakeoff/), which Caleb ranked first on both clips
 * without knowing which engine produced what.
 *
 * Consequence to keep in mind: gpt-transcribe is the yardstick, not a
 * contestant. Its 0% WER here means "identical to itself", not "perfect".
 * Every other figure IS a comparison against a human-validated best.
 */
const REFERENCES = {
  code: `Et Claude, j'aimerais que tu modifies le fichier agent.md et que tu ajustes le fichier transcription.tsx pour qu'il puisse prendre en compte la nouvelle architecture sur laquelle je travaille. Bien évidemment, il faudrait que le code soit suffisamment précis, que ce soit du clean code, du code solide et qui utilise les best practices d'ingénierie et de programming. Donc l'idée est vraiment de pouvoir être sûr que l'application soit suffisamment scalable, maintenable sur le long terme. Maintenant, je vais ouvrir Cursor pour voir un petit peu effectivement à quel niveau où le code se trouve et voir aussi si c'est possible de pouvoir modifier certaines parties qui avaient été faites par les modèles précédents qui étaient beaucoup moins intelligents à l'époque.`,

  feature: `Hey Claude, depuis un moment, je réfléchis à une fonctionnalité qui me tracasse un peu. Je me suis rendu compte, par exemple, qu'avec le mode de transcription ou d'enregistrement actuel qui utilise l'API de Groq et les modèles Whisper, Whisper large et GPT Real Time, je me suis rendu compte qu'au bout d'une minute, voire plus, ce combo-là ne fonctionne plus. Donc j'ai du mal vraiment à avoir une transcription fidèle, précise, et parfois le modèle délire un peu ou il hallucine en ajoutant certaines phrases qui sortent de leur contexte, quoi. Et du coup, je me posais la question de savoir si est-ce qu'il ne serait pas intéressant de pouvoir proposer un mode hybride ou auto dans lequel les enregistrements qui font plus d'une minute, par exemple, puissent être routés sur OpenRouter en utilisant des modèles comme GPT, le nouveau GPT qui est sorti, je ne sais pas exactement quel est le nom, ou alors comme LLM GPT Luna. Donc c'est à cette approche que je pensais et effectivement, le modèle basé sur l'API de Groq est intéressant dans le sens où ça ne coûte pas de l'argent, donc potentiellement combiner les deux serait une bonne chose, quoi. Et aussi, peut-être proposer un troisième choix, si possible, qui serait basé sur uniquement utiliser OpenRouter parce qu'à mon sens, c'est l'option qui sera la plus fiable qui soit, mais elle vient avec un coût associé, potentiellement à la vitesse, parce que ça prendra un peu plus de temps, je pense. En tout cas, tu me corrigeras si je me trompe, mais je me dis que ça prendra un peu plus de temps.`,
}

/** Lowercase, unify apostrophes, drop punctuation. Accents are kept: in French
 *  they carry meaning, and an engine that drops them is genuinely worse. */
function normalize(text) {
  return text
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/[«»"“”]/g, ' ')
    .replace(/[.,;:!?()\[\]{}…—–-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
}

/** Word error rate = Levenshtein distance over words / reference length. */
function wer(refWords, hypWords) {
  const n = refWords.length
  const m = hypWords.length
  let prev = Array.from({ length: m + 1 }, (_, j) => j)
  for (let i = 1; i <= n; i++) {
    const cur = [i]
    for (let j = 1; j <= m; j++) {
      cur[j] =
        refWords[i - 1] === hypWords[j - 1]
          ? prev[j - 1]
          : 1 + Math.min(prev[j - 1], prev[j], cur[j - 1])
    }
    prev = cur
  }
  return prev[m] / n
}

const results = JSON.parse(
  fs.readFileSync(path.join(DIR, 'voice-results.json'), 'utf8'),
)

const byModel = new Map()
for (const r of results) {
  const ref = normalize(REFERENCES[r.clip])
  const hyp = normalize(r.text || '')
  const score = r.error ? null : wer(ref, hyp)
  const entry = byModel.get(r.key) || { key: r.key, clips: {} }
  entry.clips[r.clip] = {
    wer: score,
    latency: r.latency,
    seconds: r.seconds,
    cost: r.cost,
    words: hyp.length,
    error: r.error,
  }
  byModel.set(r.key, entry)
}

const rows = [...byModel.values()].map(e => {
  const clips = Object.entries(e.clips)
  const werValues = clips.map(([, c]) => c.wer).filter(v => v !== null)
  const avgWer = werValues.length
    ? werValues.reduce((a, b) => a + b, 0) / werValues.length
    : null
  // Real-time factor: seconds of audio handled per second of wall clock.
  const rtfValues = clips
    .filter(([, c]) => !c.error && c.latency)
    .map(([, c]) => c.seconds / c.latency)
  const avgRtf = rtfValues.length
    ? rtfValues.reduce((a, b) => a + b, 0) / rtfValues.length
    : null
  return {
    key: e.key,
    avgWer,
    avgRtf,
    perClip: e.clips,
  }
})

rows.sort((a, b) => (a.avgWer ?? 9) - (b.avgWer ?? 9))

console.log(
  'model'.padEnd(36) +
    'WER'.padStart(8) +
    'RTF'.padStart(9) +
    '  code / feature latency',
)
console.log('-'.repeat(88))
for (const r of rows) {
  const lat = Object.entries(r.perClip)
    .map(([c, v]) => `${c}=${v.error ? 'ERR' : v.latency.toFixed(1) + 's'}`)
    .join(' ')
  console.log(
    r.key.padEnd(36) +
      (r.avgWer === null ? 'n/a' : (r.avgWer * 100).toFixed(1) + '%').padStart(
        8,
      ) +
      (r.avgRtf === null ? 'n/a' : r.avgRtf.toFixed(1) + '×').padStart(9) +
      '  ' +
      lat,
  )
}

fs.writeFileSync(
  path.join(DIR, 'voice-scores.json'),
  JSON.stringify(rows, null, 2),
)
console.log('\nwrote voice-scores.json')
