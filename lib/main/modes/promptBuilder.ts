import type { ChatMessage } from '../transcription/OpenRouterChatService'
import type { ContextData } from '../context/ContextGrabber'
import type { Mode } from '../sqlite/models'
import { LANGUAGE_NAMES } from '../../constants/modeLanguages'

const FALLBACK_INSTRUCTIONS =
  "Format the user's message. Fix grammar, spelling and punctuation. Output only the formatted text."

/**
 * Assemble le prompt d'un mode.
 *
 * La dictée est le **message utilisateur** — c'est l'hypothèse que font les
 * instructions elles-mêmes, qui parlent de « the user message ». Le lot 2 y
 * ajoute les exemples en faux tours de conversation et les contextes.
 */
export async function buildMessages(
  transcript: string,
  mode: Mode,
  _context: ContextData,
): Promise<ChatMessage[]> {
  const instructions = mode.instructions.trim() || FALLBACK_INSTRUCTIONS
  const languageName =
    mode.language === 'auto'
      ? null
      : LANGUAGE_NAMES[mode.language as keyof typeof LANGUAGE_NAMES]

  const system = languageName
    ? `${instructions}\n\nAlways write the result in ${languageName}.`
    : instructions

  return [
    { role: 'system', content: system },
    { role: 'user', content: transcript },
  ]
}
