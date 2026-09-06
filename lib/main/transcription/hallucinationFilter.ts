/**
 * Filet anti-hallucination commun à tous les moteurs vocaux.
 *
 * Whisper et ses dérivés, face à un silence ou un bruit, produisent deux
 * artefacts bien connus : des phrases apprises sur des sous-titres
 * (« Sous-titres réalisés par la communauté d'Amara.org », « Thank you for
 * watching ») et une phrase répétée en boucle jusqu'à la fin du segment.
 * Groq filtre déjà par segment avec `no_speech_prob` ; Deepgram, OpenAI et
 * Google ne renvoient rien d'équivalent. Ce module ne dépend d'aucun moteur.
 *
 * Volontairement conservateur : une phrase-type n'est retirée que si elle
 * forme une phrase entière, et une répétition n'est réduite qu'à partir de
 * trois occurrences consécutives d'un groupe d'au moins trois mots.
 */

const KNOWN_HALLUCINATIONS = [
  // Le classique des silences en français : le générique de Radio-Canada,
  // appris sur des milliers d'heures de télévision sous-titrée.
  /sous-?titrage\s+(par\s+|de\s+la\s+)?soci[ée]t[ée]\s+radio-?canada/i,
  /sous-?titrage\s+st'?\s*\d+/i,
  /sous-?titres? (réalisés?|faits?) par (la communauté d'?)?amara\.org/i,
  /sous-?titrage (par|de) (la )?(société|communauté)/i,
  /sous-?titres? par [\p{L}\s.]+/iu,
  /merci de votre attention/i,
  /merci d'avoir suivi/i,
  /à (bientôt|la prochaine)\s*!?$/i,
  /merci d'avoir regardé( cette vidéo)?/i,
  /n'oubliez pas de (vous )?abonner/i,
  /abonnez-vous( à la chaîne)?/i,
  /thank you for watching/i,
  /thanks for watching/i,
  /please subscribe/i,
  /subtitles by (the )?amara\.org community/i,
  /subtitles by/i,
  /transcribed by/i,
  /www\.[a-z0-9-]+\.(com|org|net)/i,
]

const MIN_REPEAT_WORDS = 3
const MIN_REPEATS = 3

function normalizeWord(word: string): string {
  return word
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '')
}

/** Retire les phrases qui ne sont qu'une hallucination connue. */
export function stripKnownHallucinations(text: string): string {
  const sentences = text.split(/(?<=[.!?…])\s+|\n+/)
  const kept = sentences.filter(sentence => {
    const trimmed = sentence.trim()
    if (!trimmed) return false
    return !KNOWN_HALLUCINATIONS.some(pattern => {
      const match = trimmed.match(pattern)
      // La phrase entière doit être l'hallucination, à la ponctuation près :
      // « merci d'avoir regardé le rapport » est une vraie phrase.
      if (!match) return false
      const rest = trimmed.replace(match[0], '').replace(/[^\p{L}\p{N}]/gu, '')
      return rest.length === 0
    })
  })
  return kept.join(' ').trim()
}

/**
 * Ramène un groupe de mots répété en boucle à une seule occurrence. Les
 * mots sont comparés normalisés, mais c'est le texte d'origine de la
 * première occurrence qui est conservé.
 */
export function collapseRepeatedPhrases(text: string): string {
  const tokens = text.split(/\s+/).filter(Boolean)
  if (tokens.length < MIN_REPEAT_WORDS * MIN_REPEATS) return text
  const normalized = tokens.map(normalizeWord)

  const out: string[] = []
  let i = 0
  while (i < tokens.length) {
    let collapsed = false
    const maxLen = Math.floor((tokens.length - i) / MIN_REPEATS)
    for (let len = maxLen; len >= MIN_REPEAT_WORDS; len--) {
      let repeats = 1
      while (
        i + (repeats + 1) * len <= tokens.length &&
        samePhrase(normalized, i, i + repeats * len, len)
      ) {
        repeats++
      }
      if (repeats >= MIN_REPEATS) {
        out.push(...tokens.slice(i, i + len))
        i += repeats * len
        collapsed = true
        break
      }
    }
    if (!collapsed) {
      out.push(tokens[i])
      i++
    }
  }
  return out.join(' ')
}

function samePhrase(
  words: string[],
  a: number,
  b: number,
  len: number,
): boolean {
  for (let k = 0; k < len; k++) {
    if (!words[a + k] || words[a + k] !== words[b + k]) return false
  }
  return true
}

/** Le transcript nettoyé ; vide s'il n'était qu'une hallucination. */
export function sanitizeTranscript(text: string): string {
  if (!text) return ''
  return collapseRepeatedPhrases(stripKnownHallucinations(text))
}
