import type { ChatMessage } from '../transcription/OpenRouterChatService'
import type { ContextData } from '../context/ContextGrabber'
import type { Mode } from '../sqlite/models'
import { LANGUAGE_NAMES } from '../../constants/modeLanguages'
import { ModeExamplesTable } from './ModeRepository'

/**
 * Fabrique la conversation envoyée au modèle texte.
 *
 * Trois choix de forme, tous délibérés :
 *
 * - **Les exemples sont de vrais tours de conversation**, pas une liste dans
 *   le prompt système. C'est la forme que les API de chat comprennent le
 *   mieux, et elle montre au modèle ce qu'il doit *produire* plutôt que de le
 *   lui décrire.
 * - **La dictée est le dernier message utilisateur.** Les instructions écrites
 *   par l'utilisateur parlent de « the user message » : la dictée doit donc en
 *   être un, sans quoi les instructions désignent quelque chose qui n'existe
 *   pas.
 * - **Les contextes sont balisés en XML** dans ce même message, avant la
 *   dictée. Un modèle distingue mieux « ce que je dois traiter » de « ce qui
 *   m'aide à le traiter » avec des balises qu'avec des tirets.
 */

const FALLBACK_INSTRUCTIONS =
  "You are a text formatting AI. Format the user's message: fix grammar, spelling and punctuation, apply any spoken self-correction, and output only the formatted text — no commentary, no answer."

const SAME_LANGUAGE_CLAUSE =
  'Do not translate. Write the result in the same language as the user message.'

/** Un bloc de contexte, ou rien du tout quand il n'y a rien à dire. */
function block(tag: string, body: string): string {
  const trimmed = body.trim()
  return trimmed ? `<${tag}>\n${trimmed}\n</${tag}>\n\n` : ''
}

function buildSystemMessage(mode: Mode): string {
  const instructions = mode.instructions.trim() || FALLBACK_INSTRUCTIONS

  if (mode.language === 'auto') {
    return `${instructions}\n\n${SAME_LANGUAGE_CLAUSE}`
  }

  const languageName =
    LANGUAGE_NAMES[mode.language as keyof typeof LANGUAGE_NAMES]
  return languageName
    ? `${instructions}\n\nAlways write the result in ${languageName}, whatever language the user message is in.`
    : `${instructions}\n\n${SAME_LANGUAGE_CLAUSE}`
}

function buildUserMessage(
  transcript: string,
  mode: Mode,
  context: ContextData,
) {
  let content = ''

  if (mode.contextApplication) {
    content += block(
      'application_context',
      [
        context.appName && `Application: ${context.appName}`,
        context.windowTitle && `Window: ${context.windowTitle}`,
      ]
        .filter(Boolean)
        .join('\n'),
    )
  }

  if (mode.contextClipboard) {
    content += block('copied_text', context.clipboardText)
  }

  if (mode.contextSelection) {
    content += block('selected_text', context.contextText)
  }

  // Ce que le moteur vocal lui-même n'était pas sûr d'avoir compris. Un bloc
  // de contexte, pas un marquage dans la dictée : rien ne peut fuir dans le
  // texte rendu, et le modèle sait où chercher les mots mal entendus.
  const uncertain = (context.lowConfidenceSegments ?? []).filter(s => s.trim())
  if (uncertain.length > 0) {
    content += block(
      'low_confidence_segments',
      'The speech engine was unsure about these passages of the dictation; they are the most likely to contain misheard words:\n' +
        uncertain.map(s => `- ${s.trim()}`).join('\n'),
    )
  }

  return content + transcript
}

export async function buildMessages(
  transcript: string,
  mode: Mode,
  context: ContextData,
): Promise<ChatMessage[]> {
  const messages: ChatMessage[] = [
    { role: 'system', content: buildSystemMessage(mode) },
  ]

  let examples: { spokenInput: string; aiOutput: string }[] = []
  try {
    examples = await ModeExamplesTable.findByMode(mode.id)
  } catch (error) {
    // Un exemple illisible ne doit pas coûter la dictée.
    console.warn('[promptBuilder] Could not read the mode examples:', error)
  }

  for (const example of examples) {
    const spoken = example.spokenInput?.trim()
    const output = example.aiOutput?.trim()
    // Une moitié manquante apprendrait au modèle à répondre par du vide.
    if (!spoken || !output) continue
    messages.push({ role: 'user', content: spoken })
    messages.push({ role: 'assistant', content: output })
  }

  messages.push({
    role: 'user',
    content: buildUserMessage(transcript, mode, context),
  })

  return messages
}
