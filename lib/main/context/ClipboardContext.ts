import { clipboard } from 'electron'

/**
 * Le presse-papier comme contexte de prompt.
 *
 * Plafonné parce qu'un presse-papier peut contenir un fichier entier, et
 * qu'un prompt qui explose la fenêtre de contexte échoue **après** la dictée,
 * c'est-à-dire au moment où l'utilisateur attend son texte. La coupure tombe
 * sur une frontière de mot et est annoncée, pour que le modèle sache que ce
 * qu'il lit est incomplet.
 */
const DEFAULT_MAX_CHARS = 8000

/**
 * Le dernier texte qu'Ito a inséré.
 *
 * Sous Windows l'insertion passe par le presse-papier et ne le restaure pas :
 * sans cette mémoire, le contexte « Copied text » relirait presque toujours la
 * dictée précédente et un mode de synthèse se résumerait lui-même.
 */
let lastInsertedText = ''

export function rememberInsertedText(text: string): void {
  lastInsertedText = text.trim()
}

export function readClipboardText(maxChars = DEFAULT_MAX_CHARS): string {
  let text: string
  try {
    text = clipboard.readText() || ''
  } catch (error) {
    console.warn('[ClipboardContext] Could not read the clipboard:', error)
    return ''
  }

  const trimmed = text.trim()

  if (trimmed && trimmed === lastInsertedText) {
    console.log(
      '[ClipboardContext] Clipboard still holds our own last insert, skipping',
    )
    return ''
  }

  if (trimmed.length <= maxChars) return trimmed

  const cut = trimmed.slice(0, maxChars)
  const lastSpace = cut.lastIndexOf(' ')
  const body = lastSpace > maxChars * 0.8 ? cut.slice(0, lastSpace) : cut
  return `${body}\n[truncated]`
}
