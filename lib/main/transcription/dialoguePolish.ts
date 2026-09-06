import type { AdvancedSettings } from '../store'
import type { SpeakerSegment } from './DeepgramTranscriptionService'
import { DEFAULT_TEXT_KEY, resolveModel } from '../../constants/modelCatalog'
import { localTranscriptionService } from './LocalTranscriptionService'
import {
  openRouterChatService,
  type ChatMessage,
} from './OpenRouterChatService'

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
  const paragraphs = text
    .split(/\n{2,}|(?<=[.!?…])\s+(?=[A-ZÀ-ÝÉ])/)
    .map(p => p.trim())
    .filter(Boolean)
  if (paragraphs.length === 0) return text
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
