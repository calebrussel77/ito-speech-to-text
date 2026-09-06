/**
 * Deterministic post-ASR dictionary enforcement.
 *
 * Whisper's prompt only *suggests* vocabulary — it regularly mangles
 * technical English terms inside French dictation ("guithub", "way finder",
 * "cloud code"). This pass makes the user dictionary authoritative: any
 * word (or word group) of the transcript that is a near-miss of a dictionary
 * term is rewritten with the term's canonical spelling.
 *
 * Matching is conservative: case- and accent-insensitive, separator-
 * insensitive, with an edit-distance budget that scales with term length
 * (short terms must match exactly) so common French words are never
 * clobbered.
 */

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\s\-_.']/g, '')
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  const rows = a.length + 1
  const cols = b.length + 1
  let prev = Array.from({ length: cols }, (_, j) => j)
  for (let i = 1; i < rows; i++) {
    const current = [i]
    for (let j = 1; j < cols; j++) {
      const substitution = prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      current[j] = Math.min(prev[j] + 1, current[j - 1] + 1, substitution)
    }
    prev = current
  }
  return prev[cols - 1]
}

function maxDistanceFor(normalizedTerm: string): number {
  if (normalizedTerm.length >= 8) return 2
  if (normalizedTerm.length >= 5) return 1
  return 0
}

type Token = {
  prefix: string // leading punctuation, e.g. « ( "
  core: string // the word itself
  suffix: string // trailing punctuation, e.g. . , ! »
}

const TOKEN_PATTERN = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u

function parseToken(raw: string): Token {
  const match = raw.match(TOKEN_PATTERN)
  if (!match || !match[2]) {
    return { prefix: '', core: raw, suffix: '' }
  }
  return { prefix: match[1], core: match[2], suffix: match[3] }
}

// A dictionary term is either a canonical word ("GitHub") or an explicit
// replacement pair ({ from: 'Influenso', to: 'Nfluenzo' }) where `from` is
// the misspelling the ASR tends to produce and `to` the wanted spelling.
export type DictionaryTerm = string | { from: string; to: string }

/**
 * Borne inférieure de la distance d'édition à partir des histogrammes de
 * caractères : une substitution change deux compteurs, une insertion ou une
 * suppression un seul, donc `levenshtein >= ceil(sum |a_c - b_c| / 2)`. Le
 * calcul est linéaire et élimine l'immense majorité des fenêtres avant la
 * programmation dynamique, qui est quadratique.
 */
const HIST_SIZE = 37 // a-z, 0-9, et un seau pour le reste
function histogram(text: string): Uint8Array {
  const hist = new Uint8Array(HIST_SIZE)
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    let bucket = HIST_SIZE - 1
    if (code >= 97 && code <= 122) bucket = code - 97
    else if (code >= 48 && code <= 57) bucket = 26 + code - 48
    if (hist[bucket] < 255) hist[bucket]++
  }
  return hist
}
function histogramLowerBound(a: Uint8Array, b: Uint8Array): number {
  let sum = 0
  for (let i = 0; i < HIST_SIZE; i++) sum += Math.abs(a[i] - b[i])
  return Math.ceil(sum / 2)
}

type Window = {
  start: number
  size: number
  normalized: string
  hist: Uint8Array
}

export function applyDictionaryCorrections(
  transcript: string,
  vocabulary: DictionaryTerm[],
): string {
  if (!transcript || vocabulary.length === 0) return transcript

  const rawTokens = transcript.split(/(\s+)/)
  // Indices of word tokens within rawTokens (odd indices are separators)
  const wordIndices: number[] = []
  const tokens: Token[] = []
  rawTokens.forEach((raw, index) => {
    if (raw.trim().length > 0) {
      wordIndices.push(index)
      tokens.push(parseToken(raw))
    }
  })

  // Normaliser chaque mot une seule fois : `normalize` (NFD + regex) était
  // rappelé pour chaque fenêtre de chaque terme, ce qui dominait le coût.
  const normalizedCores = tokens.map(token => normalize(token.core))
  const windowCache = new Map<number, Window[]>()
  const windowsOfSize = (size: number): Window[] => {
    let windows = windowCache.get(size)
    if (!windows) {
      windows = []
      for (let start = 0; start + size <= tokens.length; start++) {
        let normalized = ''
        for (let k = 0; k < size; k++) normalized += normalizedCores[start + k]
        if (normalized.length === 0) continue
        windows.push({ start, size, normalized, hist: histogram(normalized) })
      }
      windowCache.set(size, windows)
    }
    return windows
  }

  const consumed = new Set<number>() // word positions already rewritten

  // Both sides of a replacement pair are matched (the ASR may produce either
  // a near-miss of the misspelling or of the correct form); the rewrite
  // always targets the correct form.
  const entries = vocabulary
    .map(term =>
      typeof term === 'string'
        ? { matchKeys: [term], written: term }
        : {
            matchKeys: term.from === term.to ? [term.to] : [term.from, term.to],
            written: term.to,
          },
    )
    .filter(entry => entry.written.trim().length > 0)
    // Longer terms first so "Claude Code" wins over a hypothetical "Code"
    .sort(
      (a, b) =>
        Math.max(...b.matchKeys.map(k => k.length)) -
        Math.max(...a.matchKeys.map(k => k.length)),
    )

  for (const entry of entries) {
    for (const key of entry.matchKeys) {
      const normalizedTerm = normalize(key)
      if (normalizedTerm.length < 3) continue // too short to correct safely
      const budget = maxDistanceFor(normalizedTerm)
      const termHist = histogram(normalizedTerm)
      const termWordCount = key.trim().split(/\s+/).length

      const windowSizes = [
        ...new Set([termWordCount, termWordCount + 1, termWordCount - 1]),
      ].filter(size => size >= 1)

      for (const windowSize of windowSizes) {
        for (const window of windowsOfSize(windowSize)) {
          const { start, normalized: candidate } = window
          // Cheap pre-filters before the DP, cheapest first.
          if (Math.abs(candidate.length - normalizedTerm.length) > budget) {
            continue
          }
          if (histogramLowerBound(window.hist, termHist) > budget) continue

          const positions = Array.from(
            { length: windowSize },
            (_, k) => start + k,
          )
          if (positions.some(p => consumed.has(p))) continue
          if (levenshtein(candidate, normalizedTerm) > budget) continue

          // Rewrite the window with the canonical spelling, keeping outer
          // punctuation of the first and last words.
          const first = tokens[positions[0]]
          const last = tokens[positions[windowSize - 1]]
          rawTokens[wordIndices[positions[0]]] =
            first.prefix + entry.written + last.suffix
          for (let k = 1; k < windowSize; k++) {
            // Blank out the rest of the window and its leading separator
            rawTokens[wordIndices[positions[k]]] = ''
            rawTokens[wordIndices[positions[k]] - 1] = ''
          }
          positions.forEach(p => consumed.add(p))
        }
      }
    }
  }

  return rawTokens.join('')
}
