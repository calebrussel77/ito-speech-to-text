import type { AdvancedSettings } from '../store'
import type { SpeakerSegment } from './DeepgramTranscriptionService'
import { DEFAULT_TEXT_KEY, resolveModel } from '../../constants/modelCatalog'
import { localTranscriptionService } from './LocalTranscriptionService'
import {
  openRouterChatService,
  type ChatMessage,
} from './OpenRouterChatService'
import { parseDialogueTranscript, speakerLabelWord } from './dialogueTranscript'

/**
 * Relecture d'un transcript rendu par un ASR (Deepgram, OpenAI) par le
 * modèle texte par défaut.
 *
 * Un ASR entend ; il n'a pas de vocabulaire produit, il ponctue peu, et il
 * rend « Nfluenzo » comme « influence zoo ». Le modèle texte, lui, sait ce
 * qu'un développeur ou un commercial francophone dit, et connaît le
 * dictionnaire de l'utilisateur. Il corrige donc les mots mal entendus, la
 * ponctuation et la casse — et rien d'autre : même nombre de tours, même
 * ordre, mêmes locuteurs, jamais de résumé.
 *
 * Fait par blocs de tours pour que le modèle garde chaque ligne en tête,
 * et vérifié ligne à ligne : un bloc dont la réponse n'a pas la forme
 * attendue garde son texte d'origine. Le transcript multimodal (Gemini)
 * n'y passe pas : il a déjà eu ces consignes en écoutant l'audio.
 */

const TURNS_PER_BLOCK = 40
const MAX_CONCURRENT_BLOCKS = 3
/** Des morceaux qu'un modèle rend fidèlement en une réponse. */
const INFER_CHUNK_WORDS = 4000
/** Une réunion entière à relire ou à structurer : minutes, pas secondes. */
const LONG_CALL_TIMEOUT_MS = 10 * 60 * 1000

function instruction(vocabulary: string[]): string {
  const vocabularyClause = vocabulary.length
    ? `\n- Names and product terms that must be spelled exactly like this whenever they were meant: ${vocabulary.join(', ')}.`
    : ''
  return `You proofread a speech-to-text transcript of a conversation. Each input line is one turn, prefixed with its number.

Fix ONLY:
- words the speech engine misheard, when the intended word is obvious from context — especially technical terms, product names, company names and people's names;
- punctuation, capitalisation and obvious spelling.${vocabularyClause}

Never:
- change the meaning, reorder, merge, split, drop or add turns;
- summarise, shorten, translate, or polish the spoken style (keep hesitations that carry meaning, keep the language as spoken, keep code-switching);
- add any comment.

Output exactly one line per input line, in the same order, as "<number>: <corrected text>". Nothing else.`
}

function parseBlock(output: string, expected: number): string[] | null {
  const lines = output
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
  const byIndex = new Map<number, string>()
  for (const line of lines) {
    const match = line.match(/^(\d+)\s*[:.)-]\s*(.*)$/)
    if (!match) continue
    byIndex.set(Number(match[1]), match[2].trim())
  }
  if (byIndex.size !== expected) return null
  const result: string[] = []
  for (let i = 1; i <= expected; i++) {
    const text = byIndex.get(i)
    if (text === undefined) return null
    result.push(text)
  }
  return result
}

async function complete(
  messages: ChatMessage[],
  advancedSettings: AdvancedSettings,
): Promise<string> {
  const model = resolveModel(advancedSettings.textModelKey, DEFAULT_TEXT_KEY)
  if (model.provider === 'openrouter') {
    return openRouterChatService.complete({
      apiKey: advancedSettings.openRouterApiKey || '',
      model: model.slug,
      messages,
      temperature: 0.1,
      pinnedProvider: model.pinnedProvider,
      reasoningEffort: model.reasoning,
      timeoutMs: LONG_CALL_TIMEOUT_MS,
    })
  }
  localTranscriptionService.initialize(advancedSettings.groqApiKey || '')
  return localTranscriptionService.complete({
    model: model.slug,
    messages,
    temperature: 0.1,
    reasoningEffort: model.reasoning,
  })
}

/**
 * Les segments relus. Toute défaillance d'un bloc rend ce bloc tel quel :
 * une relecture est une amélioration, jamais une condition.
 */
export async function polishDialogue(
  segments: SpeakerSegment[],
  vocabulary: string[],
  advancedSettings: AdvancedSettings,
): Promise<SpeakerSegment[]> {
  if (segments.length === 0) return segments
  const system = instruction(vocabulary)
  const blocks: SpeakerSegment[][] = []
  for (let i = 0; i < segments.length; i += TURNS_PER_BLOCK) {
    blocks.push(segments.slice(i, i + TURNS_PER_BLOCK))
  }

  const polishBlock = async (
    block: SpeakerSegment[],
  ): Promise<SpeakerSegment[]> => {
    const user = block
      .map(
        (segment, i) => `${i + 1}: ${segment.text.replace(/\s+/g, ' ').trim()}`,
      )
      .join('\n')
    try {
      const output = await complete(
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        advancedSettings,
      )
      const corrected = parseBlock(output, block.length)
      if (!corrected) {
        console.warn('[dialoguePolish] Block came back malformed, kept as is')
        return block
      }
      return block.map((segment, i) => ({
        ...segment,
        text: corrected[i] || segment.text,
      }))
    } catch (error: any) {
      console.warn('[dialoguePolish] Block failed, kept as is:', error?.message)
      return block
    }
  }

  const results: SpeakerSegment[][] = new Array(blocks.length)
  let next = 0
  const workers = Array.from(
    { length: Math.min(MAX_CONCURRENT_BLOCKS, blocks.length) },
    async () => {
      while (next < blocks.length) {
        const index = next++
        results[index] = await polishBlock(blocks[index])
      }
    },
  )
  await Promise.all(workers)
  return results.flat()
}

/** Même relecture pour un transcript à une voix, découpé en paragraphes. */
export async function polishPlainText(
  text: string,
  vocabulary: string[],
  advancedSettings: AdvancedSettings,
): Promise<string> {
  const sentences = text
    .split(/\n{2,}|(?<=[.!?…])\s+(?=[A-ZÀ-ÝÉ])/)
    .map(p => p.trim())
    .filter(Boolean)
  if (sentences.length === 0) return text
  // Des unités d'environ 80 mots : assez courtes pour que le modèle les
  // rende fidèlement, assez longues pour ne pas multiplier les appels — une
  // relecture phrase par phrase d'un appel de 26 minutes prenait une minute.
  const paragraphs: string[] = []
  let current = ''
  for (const sentence of sentences) {
    const merged = current ? `${current} ${sentence}` : sentence
    if (current && merged.split(/\s+/).length > 80) {
      paragraphs.push(current)
      current = sentence
    } else {
      current = merged
    }
  }
  if (current) paragraphs.push(current)
  const segments = paragraphs.map((paragraph, i) => ({
    speaker: 0,
    label: '',
    startMs: i,
    endMs: i,
    text: paragraph,
  }))
  const polished = await polishDialogue(segments, vocabulary, advancedSettings)
  return polished.map(segment => segment.text).join(' ')
}

/**
 * Les locuteurs déduits du texte seul, quand le moteur vocal n'a pas su
 * séparer les voix (tout modèle sans diarisation : gpt-transcribe, Whisper…).
 *
 * Un modèle texte ne reconnaît pas des voix, mais il reconnaît une
 * conversation : une question puis sa réponse, un « d'accord », le passage
 * du « je » au « vous ». Mesuré sur un appel de prospection de 26 minutes
 * transcrit à plat : deux locuteurs, 119 tours, tous les mots conservés, en
 * 30 s. Un monologue lui revient en paragraphes, sans étiquette — et le
 * parseur le confirme en ne trouvant aucun tour.
 *
 * La relecture des mots mal entendus est faite dans le même passage : un
 * second aller-retour sur 3 000 mots doublerait le coût pour rien.
 */
export async function inferSpeakersFromText(
  text: string,
  options: { vocabulary: string[]; language?: string },
  advancedSettings: AdvancedSettings,
): Promise<{
  isConversation: boolean
  segments: SpeakerSegment[]
  text: string
}> {
  const label = speakerLabelWord(options.language)
  const vocabularyClause = options.vocabulary.length
    ? ` Spell these exactly: ${options.vocabulary.join(', ')}.`
    : ''
  const system = `You receive the plain transcript of a recording, produced by a speech engine that does not separate voices. The recording may be a conversation between several people (a call, a meeting, an interview) or one person speaking alone.

First decide, from the content, how many people speak. Then output the transcript again:
- If several people speak: one line per turn, "${label} 1 : …", "${label} 2 : …", labels in order of first appearance, stable for the whole transcript. When a role is obvious (the person presenting an offer versus the person answering), add it in parentheses the first time only, e.g. "${label} 1 (sales)". Split turns where the speaker clearly changes: a question followed by its answer, an acknowledgement, a change of perspective ("I" versus "you"). When unsure where a turn ends, keep the text with the current speaker.
- If one person speaks: output the transcript as plain paragraphs, without any label.

In both cases, keep every word: never summarise, drop, reorder or add anything. Fix only words the speech engine obviously misheard (product names, technical terms, people's names) and punctuation.${vocabularyClause}
Output nothing but the transcript.`

  const words = text.split(/\s+/).filter(Boolean)
  const chunks: string[] = []
  for (let i = 0; i < words.length; i += INFER_CHUNK_WORDS) {
    chunks.push(words.slice(i, i + INFER_CHUNK_WORDS).join(' '))
  }

  let previousTail = ''
  const outputs: string[] = []
  for (const chunk of chunks) {
    const user = previousTail
      ? `Already attributed, for context only (do not repeat it, keep the same labels):\n${previousTail}\n\nContinue with this part:\n${chunk}`
      : chunk
    let output = ''
    for (let attempt = 1; attempt <= 2 && !output.trim(); attempt++) {
      try {
        output = await complete(
          [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          advancedSettings,
        )
      } catch (error: any) {
        console.warn(
          `[dialoguePolish] Speaker inference attempt ${attempt} failed:`,
          error?.message,
        )
      }
    }
    if (!output.trim()) {
      // Un morceau perdu invaliderait les étiquettes de tout ce qui suit :
      // on rend le texte tel quel plutôt qu'un dialogue à trous.
      return { isConversation: false, segments: [], text }
    }
    outputs.push(output.trim())
    previousTail = output
      .trim()
      .split('\n')
      .filter(Boolean)
      .slice(-3)
      .join('\n')
  }

  const joined = outputs.join('\n')
  const parsed = parseDialogueTranscript(joined)
  // Un modèle qui aurait perdu ou inventé plus de 10 % des mots n'a pas
  // structuré le transcript, il l'a réécrit : on garde l'original.
  const outWords = parsed.text.split(/\s+/).filter(Boolean).length
  if (Math.abs(outWords - words.length) > words.length * 0.1) {
    console.warn(
      `[dialoguePolish] Speaker inference changed the word count (${words.length} -> ${outWords}), kept the original text`,
    )
    return { isConversation: false, segments: [], text }
  }
  return parsed.isConversation
    ? parsed
    : { isConversation: false, segments: [], text: joined }
}
