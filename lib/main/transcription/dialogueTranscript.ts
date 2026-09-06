import type { SpeakerSegment } from './DeepgramTranscriptionService'
import { parseClock } from './clock'

/**
 * Transcription d'un enregistrement importé par un modèle multimodal
 * (Gemini), en texte libre plutôt qu'en JSON contraint.
 *
 * Le schéma JSON qu'on imposait auparavant dégradait la transcription des
 * longues réunions : les modèles rendent un bien meilleur transcript quand
 * on les laisse écrire du texte, et un transcript en dialogue se relit
 * sans effort. C'est aussi le format que l'utilisateur obtenait à la main
 * dans AI Studio et qui lui donnait satisfaction ; ces instructions en sont
 * la version générique.
 *
 * Le modèle décide lui-même de la forme : dialogue étiqueté et horodaté
 * s'il entend plusieurs voix, texte simple s'il n'y en a qu'une. Le parseur
 * ci-dessous relit le résultat et rend les segments quand il y a bien un
 * dialogue, sinon le texte tel quel.
 */

const LABEL_WORD: Record<string, string> = {
  fr: 'Locuteur',
  en: 'Speaker',
  es: 'Hablante',
  de: 'Sprecher',
  it: 'Parlante',
  pt: 'Falante',
}

export function speakerLabelWord(language?: string): string {
  return LABEL_WORD[(language || '').toLowerCase()] ?? 'Speaker'
}

export function buildDialogueInstruction(options: {
  language?: string
  vocabulary?: string[]
}): string {
  const label = speakerLabelWord(options.language)
  const languageClause = options.language
    ? `The recording is expected to be mostly in "${options.language}"; transcribe every passage in the language actually spoken, and keep code-switching (for instance French with English technical terms) exactly as spoken.`
    : 'Transcribe every passage in the language actually spoken, and keep code-switching exactly as spoken.'
  const vocabulary = (options.vocabulary ?? []).filter(v => v.trim())
  const vocabularyClause = vocabulary.length
    ? `\n- Spell these names and product terms exactly like this whenever they are said: ${vocabulary.join(', ')}.`
    : ''

  return `# ROLE
You are an expert in audio transcription and speaker diarization. Your mission is to produce a complete, faithful, ready-to-use transcript of a recording.

# CONTEXT
The recording may be a meeting, a sales call, a demo or an interview between several people — or a single person's memo or monologue. It may contain technical and product vocabulary, and a mix of languages. ${languageClause}

# FIDELITY
- Transcribe word for word: never rephrase, summarise, translate, answer, comment, or correct the spoken style.
- Keep meaningful hesitations only when they carry meaning; otherwise lighten them for readability.
- Preserve the exact spelling of proper nouns and product names.${vocabularyClause}
- Inaudible or uncertain passage: write [inaudible] or [uncertain: probable text]. Overlapping voices: write [overlap] and transcribe as best you can. Long silence or cut: write [silence] or [audio cut].

# SPEAKERS
- First decide how many distinct voices the recording contains.
- If there are TWO OR MORE speakers: give each voice a stable label, "${label} 1", "${label} 2", … in order of first appearance, and never change the label of a given voice. When the context makes a role obvious (the person presenting a demo versus the person discovering it), add it in parentheses the first time only, e.g. "${label} 1 (presenter)".
- If there is only ONE speaker: do not use any label or timestamp; write the transcript as plain paragraphs.

# OUTPUT FORMAT
With several speakers, one line per turn, each starting with a timestamp:
[HH:MM:SS] ${label} 1 : what was said
[HH:MM:SS] ${label} 2 : what was said
With a single speaker, plain paragraphs only.

Output nothing but the transcript: no preamble, no title, no closing remark.`
}

export type DialogueParse = {
  /** Les tours de parole, vides si le texte n'est pas un dialogue. */
  segments: SpeakerSegment[]
  /** Au moins deux voix distinctes reconnues. */
  isConversation: boolean
  /** Le transcript à afficher : texte brut, ou le dialogue nettoyé. */
  text: string
}

// [00:12:03] Locuteur 1 (présentateur) : Bonjour   — ou sans horodatage.
const TURN_PATTERN =
  /^\s*(?:\[?\(?((?:\d{1,2}:)?\d{1,2}:\d{2})\)?\]?\s*)?([^:\n[\]]{1,80}?)\s*:\s*(.+)$/

/** « Locuteur 1 (présentateur) » → « locuteur 1 », clé stable d'une voix. */
function speakerKey(label: string): string {
  return label
    .replace(/\(.*?\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * Une étiquette de locuteur est courte et ressemble à un nom : « Locuteur
 * 1 », « Speaker 2 », « Caleb », « Marie Dupont ». « Note pour moi » ou « Et
 * vérifier les prix » sont des débuts de phrase qui contiennent un
 * deux-points, pas des voix — un mémo dicté en est plein.
 */
function looksLikeSpeakerLabel(label: string): boolean {
  const words = label
    .replace(/\(.*?\)/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (words.length === 0 || words.length > 3) return false
  return words.every(word => /^[\p{Lu}\d]/u.test(word))
}

/**
 * Relit un transcript libre. Chaque ligne « [horodatage] Étiquette : texte »
 * devient un tour ; une ligne sans étiquette prolonge le tour précédent.
 * Un seul locuteur au total, et le texte est rendu tel quel : un dialogue à
 * une voix n'apprend rien.
 */
export function parseDialogueTranscript(output: string): DialogueParse {
  const lines = output.split(/\r?\n/)
  const turns: { key: string; label: string; startMs: number; text: string }[] =
    []
  let unlabelled = 0

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue
    const match = line.match(TURN_PATTERN)
    if (match) {
      const [, clock, label, text] = match
      const key = speakerKey(label)
      if (key.length > 0 && looksLikeSpeakerLabel(label)) {
        turns.push({
          key,
          label: label.trim(),
          startMs: clock ? parseClock(clock) : -1,
          text: text.trim(),
        })
        continue
      }
    }
    if (turns.length > 0) {
      turns[turns.length - 1].text += ` ${line}`
    } else {
      unlabelled++
    }
  }

  const keys = [...new Set(turns.map(turn => turn.key))]
  // Un dialogue, c'est au moins deux voix et une majorité de lignes
  // étiquetées ; sinon on a affaire à un texte qui contient des deux-points.
  if (keys.length < 2 || turns.length < unlabelled) {
    return { segments: [], isConversation: false, text: output.trim() }
  }

  const firstLabel = new Map<string, string>()
  for (const turn of turns) {
    if (!firstLabel.has(turn.key)) firstLabel.set(turn.key, turn.label)
  }

  // Un horodatage manquant hérite du précédent ; la fin d'un tour est le
  // début du suivant, ce qu'un modèle ne donne jamais mais que l'affichage
  // attend.
  let lastStart = 0
  const segments: SpeakerSegment[] = turns.map(turn => {
    const startMs = turn.startMs >= 0 ? turn.startMs : lastStart
    lastStart = startMs
    return {
      speaker: keys.indexOf(turn.key),
      label: firstLabel.get(turn.key) ?? turn.label,
      startMs,
      endMs: startMs,
      text: turn.text,
    }
  })
  for (let i = 0; i < segments.length - 1; i++) {
    segments[i].endMs = Math.max(segments[i].startMs, segments[i + 1].startMs)
  }

  return {
    segments,
    isConversation: true,
    text: segments.map(segment => segment.text).join(' '),
  }
}
