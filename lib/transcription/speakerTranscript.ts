import type { SpeakerSegment } from '@/lib/main/transcription/DeepgramTranscriptionService'

// Type ré-exporté plutôt que redéfini : les segments viennent tous du même
// endroit (Deepgram, via InteractionManager), qu'ils soient issus d'une
// réunion enregistrée en direct ou d'un fichier importé. Redéclarer le type
// ici créerait une deuxième forme que rien ne garantit de garder alignée.
//
// Ces fonctions vivaient sous `app/components/…/history/` ; elles sont
// remontées dans `lib/` le jour où le processus principal en a eu besoin —
// l'import de fichier compose le même transcript nommé. Deux implémentations
// du même format auraient divergé au premier changement.
export type { SpeakerSegment }

/**
 * mm:ss — une réunion tient rarement plus d'une heure de dictée continue, et
 * mm:ss se lit d'un coup d'œil alors qu'un hh:mm:ss constant serait surtout
 * du bruit visuel.
 */
export function formatTimestamp(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0')
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  return `${minutes}:${seconds}`
}

/**
 * Un locuteur par index, dans l'ordre de sa première apparition dans les
 * segments — c'est cet ordre qui pilote la liste affichée par le panneau de
 * renommage.
 */
export function uniqueSpeakers(
  segments: SpeakerSegment[],
): { speaker: number; label: string }[] {
  const seen = new Map<number, string>()
  for (const segment of segments) {
    if (!seen.has(segment.speaker)) seen.set(segment.speaker, segment.label)
  }
  return [...seen.entries()].map(([speaker, label]) => ({ speaker, label }))
}

/**
 * Un « locuteur » qui ne dit presque rien n'en est pas un : c'est un
 * toussotement, un « oui » en fond, ou la diarisation qui a coupé une même
 * voix en deux. Ses tours sont rendus au locuteur qui parle juste avant (ou
 * après, en tout début), pour qu'un mémo à une voix ne devienne pas un
 * dialogue à deux et qu'une réunion à deux n'en affiche pas quatre.
 *
 * Seuil : moins de 5 % des mots ET moins de trois tours. Un participant
 * discret mais réel dépasse l'un des deux.
 */
export function collapseMinorSpeakers(
  segments: SpeakerSegment[],
): SpeakerSegment[] {
  if (segments.length === 0) return segments
  const words = new Map<number, number>()
  const turns = new Map<number, number>()
  let total = 0
  for (const segment of segments) {
    const count = segment.text.split(/\s+/).filter(Boolean).length
    total += count
    words.set(segment.speaker, (words.get(segment.speaker) ?? 0) + count)
    turns.set(segment.speaker, (turns.get(segment.speaker) ?? 0) + 1)
  }
  const minor = new Set(
    [...words.keys()].filter(
      speaker =>
        (words.get(speaker) ?? 0) < total * 0.05 &&
        (turns.get(speaker) ?? 0) < 3,
    ),
  )
  if (minor.size === 0 || minor.size === words.size) return segments

  const labelOf = new Map<number, string>()
  for (const segment of segments) {
    if (!minor.has(segment.speaker) && !labelOf.has(segment.speaker)) {
      labelOf.set(segment.speaker, segment.label)
    }
  }
  const firstMajor = segments.find(s => !minor.has(s.speaker))!.speaker
  let previous = firstMajor
  return segments.map(segment => {
    if (!minor.has(segment.speaker)) {
      previous = segment.speaker
      return segment
    }
    return {
      ...segment,
      speaker: previous,
      label: labelOf.get(previous) ?? segment.label,
    }
  })
}

/**
 * Le transcript nommé et horodaté qui part dans le presse-papier — le
 * format qu'un mode avec le contexte « Copied text » lira pour produire un
 * compte-rendu par participant.
 */
export function formatSpeakerTranscript(segments: SpeakerSegment[]): string {
  return segments
    .map(
      segment =>
        `[${formatTimestamp(segment.startMs)}-${formatTimestamp(segment.endMs)}] ${segment.label}: ${segment.text}`,
    )
    .join('\n')
}
