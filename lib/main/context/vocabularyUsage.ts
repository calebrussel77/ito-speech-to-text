import store from '../store'
import { STORE_KEYS } from '../../constants/store-keys'

type UsageCounts = Record<string, number>

/** Les termes les plus dictés en premier, à égalité l'ordre alphabétique. */
export function sortByUsage<T>(items: T[], term: (item: T) => string): T[] {
  const counts = readCounts()
  return [...items].sort((a, b) => {
    const diff = (counts[key(term(b))] ?? 0) - (counts[key(term(a))] ?? 0)
    return diff !== 0 ? diff : term(a).localeCompare(term(b))
  })
}

/**
 * Compte, pour chaque terme du dictionnaire présent dans le texte final,
 * une utilisation de plus. L'amorce Whisper est plafonnée à 224 tokens :
 * quand le dictionnaire déborde, ce sont les termes réellement dictés qui
 * doivent passer en premier, pas les premiers de l'alphabet.
 */
export function recordUsage(text: string, terms: string[]): void {
  if (!text || terms.length === 0) return
  const haystack = normalize(text)
  const counts = readCounts()
  let changed = false
  for (const term of terms) {
    const needle = normalize(term)
    if (needle.length < 2 || !haystack.includes(needle)) continue
    counts[key(term)] = (counts[key(term)] ?? 0) + 1
    changed = true
  }
  if (!changed) return
  try {
    store.set(STORE_KEYS.DICTIONARY_USAGE, counts)
  } catch (error) {
    console.warn('[vocabularyUsage] Could not persist usage:', error)
  }
}

function readCounts(): UsageCounts {
  try {
    const stored = store.get(STORE_KEYS.DICTIONARY_USAGE) as unknown
    return stored && typeof stored === 'object'
      ? { ...(stored as UsageCounts) }
      : {}
  } catch {
    return {}
  }
}

const key = (term: string) => normalize(term)

function normalize(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}
