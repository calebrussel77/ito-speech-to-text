# Lot 2 — Le cerveau des modes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faire qu'un mode produise réellement quelque chose de différent d'un autre — prompt structuré, trois contextes injectables, exemples few-shot — et rendre la dictée brute consultable pour qu'on puisse corriger un mode à partir de ses échecs.

**Architecture:** `promptBuilder` devient le seul endroit qui sait fabriquer un prompt : instructions en message système, exemples en faux tours de conversation, contextes et dictée dans le message utilisateur. `ContextGrabber` lit les trois sources selon les interrupteurs du mode. Le transcript brut est persisté à côté du final, ce qui débloque la bascule Original/IA et le bouton « Add as example ».

**Tech Stack:** TypeScript, Electron `clipboard`, React 19, bun test.

**Dépend de :** [lot 1](2026-08-14-modes-lot1-visibilite.md) intégralement.

## Global Constraints

Voir [le plan directeur](2026-08-14-modes-refonte.md#global-constraints).

---

### Task 2.1 : Persister le transcript brut

**Files:**
- Modify: `lib/main/itoStreamController.ts` (`LocalTranscriptionResult` + retour)
- Modify: `lib/main/itoSessionManager.ts:188-230`
- Modify: `lib/main/interactions/InteractionManager.ts:65-74`
- Test: `lib/main/interactions/InteractionManager.test.ts`

**Interfaces:**
- Produces: `LocalTranscriptionResult.rawTranscript: string` — la sortie du moteur vocal **avant** toute réécriture, après correction du dictionnaire ; `asr_output.rawTranscript` dans l'historique

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter à `lib/main/interactions/InteractionManager.test.ts` :

```typescript
  test('stores the raw transcript alongside the rewritten one', async () => {
    interactionManager.initialize()
    await interactionManager.createInteraction(
      'Reminders:\n- Milk\n- Cheese',
      Buffer.alloc(0),
      16000,
      undefined,
      undefined,
      5000,
      {
        engine: 'whisper-large-v3-turbo',
        modeId: 'intelligent',
        modeName: 'Intelligent',
        rawTranscript: 'buy milk eggs no not eggs cheese',
      },
    )

    const [row] = mockUpsert.mock.calls.at(-1)!
    expect(row.asr_output.transcript).toBe('Reminders:\n- Milk\n- Cheese')
    expect(row.asr_output.rawTranscript).toBe(
      'buy milk eggs no not eggs cheese',
    )
  })

  test('a mode that does not rewrite stores no raw transcript — it would be a duplicate', async () => {
    interactionManager.initialize()
    await interactionManager.createInteraction(
      'same text',
      Buffer.alloc(0),
      16000,
      undefined,
      undefined,
      5000,
      { engine: 'whisper-large-v3-turbo', rawTranscript: 'same text' },
    )

    const [row] = mockUpsert.mock.calls.at(-1)!
    expect(row.asr_output.rawTranscript).toBeNull()
  })
```

> `mockUpsert` existe déjà dans ce fichier de test ; vérifier son nom avec `grep -n "upsert" lib/main/interactions/InteractionManager.test.ts` et l'adapter si nécessaire.

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `bun test --preload lib/__tests__/setup.ts lib/main/interactions/InteractionManager.test.ts`
Expected: FAIL — `rawTranscript` vaut `undefined`

- [ ] **Step 3: Implémenter**

Dans `lib/main/interactions/InteractionManager.ts`, étendre le paramètre `asr` avec `rawTranscript?: string` et l'objet `asrOutput` :

```typescript
        // Vide quand il est identique au final : le stocker deux fois
        // doublerait la base sans rien apprendre à personne. La comparaison se
        // fait après trim — un simple espace de différence ferait apparaître
        // « Show original » et « Add as example » sur une dictée que personne
        // n'a réécrite.
        rawTranscript:
          asr?.rawTranscript && asr.rawTranscript.trim() !== transcript.trim()
            ? asr.rawTranscript
            : null,
```

Dans `lib/main/itoStreamController.ts`, capturer le brut juste après la correction du dictionnaire et avant `transcriptAdjuster.adjust` :

```typescript
    transcript = applyDictionaryCorrections(transcript, context.dictionaryEntries)

    // Ce que le moteur vocal a réellement rendu. C'est la moitié gauche d'une
    // paire d'exemple, et l'onglet « Original » de l'historique : sans elle,
    // corriger un mode à partir de ses échecs est impossible.
    const rawTranscript = transcript
```

et l'ajouter au retour ainsi qu'à l'interface `LocalTranscriptionResult`.

Dans `lib/main/itoSessionManager.ts`, passer `rawTranscript: result.rawTranscript` dans l'objet `asr`.

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `bun test --preload lib/__tests__/setup.ts lib/main/interactions/InteractionManager.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/main/
git commit -m "feat(modes): persist the raw transcript next to the rewritten one"
```

---

### Task 2.2 : Bascule Original / IA dans l'historique

**Files:**
- Modify: `app/components/home/contents/HomeContent.tsx`

- [ ] **Step 1: Ajouter l'état et le bouton**

Dans `HomeContent.tsx`, à côté de `expandedItems`, ajouter :

```tsx
  const [showingRaw, setShowingRaw] = useState<Set<string>>(new Set())

  const toggleRaw = (id: string) =>
    setShowingRaw(previous => {
      const next = new Set(previous)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
```

Dans le rendu d'une ligne, après le nom du mode :

```tsx
                            {interaction.asr_output?.rawTranscript && (
                              <button
                                type="button"
                                onClick={() => toggleRaw(interaction.id)}
                                className="text-[11px] text-muted-foreground/70 underline-offset-2 hover:text-foreground hover:underline"
                              >
                                {showingRaw.has(interaction.id)
                                  ? 'Show result'
                                  : 'Show original'}
                              </button>
                            )}
```

et faire lire le texte affiché depuis le bon champ :

```tsx
                    const displayInfo = getDisplayText(interaction)
                    const shownText =
                      showingRaw.has(interaction.id) &&
                      interaction.asr_output?.rawTranscript
                        ? interaction.asr_output.rawTranscript
                        : displayInfo.text
```

Remplacer les usages de `displayInfo.text` dans le corps de la ligne par `shownText`.

> Le bouton n'apparaît que quand un brut existe **et** diffère : en mode Voice to text les deux textes sont identiques et `rawTranscript` est `null`, donc la ligne reste exactement comme avant.

- [ ] **Step 2: Vérifier visuellement**

Run: `bun dev`

1. Dicter en mode Intelligent → la ligne d'historique propose « Show original ».
2. Cliquer → le texte brut s'affiche, le libellé devient « Show result ».
3. Dicter en mode Voice to text → aucun bouton.

- [ ] **Step 3: Commit**

```bash
git add app/components/home/contents/HomeContent.tsx
git commit -m "feat(history): toggle between the raw transcript and the rewritten one"
```

---

### Task 2.3 : Contexte presse-papier et les trois interrupteurs

**Files:**
- Create: `lib/main/context/ClipboardContext.ts`
- Modify: `lib/main/context/ContextGrabber.ts`
- Test: `lib/main/context/ClipboardContext.test.ts`

**Interfaces:**
- Produces:
  - `rememberInsertedText(text: string): void` — appelé par `TextInserter` après chaque insertion
  - `readClipboardText(maxChars?: number): string` — jamais throw, tronque proprement, **ignore sa propre dictée précédente**
  - `ContextData` gagne `clipboardText: string`

**Le piège de l'auto-pollution.** Sous Windows, `TextInserter` insère en passant par le presse-papier (`native/text-writer/src/windows_writer.rs:200-202`) et la restauration de l'ancien contenu a été retirée. Le presse-papier contient donc presque toujours **la dictée précédente**. Un mode « résume le presse-papier » résumerait sa propre sortie de la veille au lieu du document visé.

Mitigation retenue : Ito retient le dernier texte qu'il a inséré ; si le presse-papier lui est identique, le contexte est traité comme vide. Invisible, aucun réglage de plus, et ça n'empêche pas de coller volontairement une dictée passée — il suffit d'en copier une autre.

- [ ] **Step 1: Écrire le test qui échoue**

```typescript
// lib/main/context/ClipboardContext.test.ts
import { describe, test, expect, mock, beforeEach } from 'bun:test'

let clipboardContent = ''
let shouldThrow = false

mock.module('electron', () => ({
  clipboard: {
    readText: () => {
      if (shouldThrow) throw new Error('clipboard unavailable')
      return clipboardContent
    },
  },
}))

const { readClipboardText } = await import('./ClipboardContext')

describe('readClipboardText', () => {
  beforeEach(() => {
    clipboardContent = ''
    shouldThrow = false
  })

  test('returns the clipboard text', () => {
    clipboardContent = '  a meeting transcript  '
    expect(readClipboardText()).toBe('a meeting transcript')
  })

  test('truncates on a word boundary and says so', () => {
    clipboardContent = 'alpha beta gamma delta'
    const result = readClipboardText(12)

    expect(result.startsWith('alpha beta')).toBe(true)
    expect(result).toContain('[truncated]')
    expect(result.length).toBeLessThan(clipboardContent.length + 20)
  })

  test('an unreadable clipboard yields an empty string, never an exception', () => {
    shouldThrow = true
    expect(readClipboardText()).toBe('')
  })

  test('an empty clipboard yields an empty string', () => {
    expect(readClipboardText()).toBe('')
  })

  test('Ito never feeds itself its own previous dictation', () => {
    // Sous Windows l'insertion passe par le presse-papier et ne le restaure
    // pas : sans ce garde-fou, un mode « résume le presse-papier » résumerait
    // sa propre sortie précédente.
    rememberInsertedText('Le compte rendu de la réunion de mardi.')
    clipboardContent = 'Le compte rendu de la réunion de mardi.'

    expect(readClipboardText()).toBe('')
  })

  test('the guard compares after trimming, not byte for byte', () => {
    rememberInsertedText('bonjour')
    clipboardContent = '  bonjour  '
    expect(readClipboardText()).toBe('')
  })

  test('copying something else clears the guard', () => {
    rememberInsertedText('bonjour')
    clipboardContent = 'un vrai document'

    expect(readClipboardText()).toBe('un vrai document')
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `bun test --preload lib/__tests__/setup.ts lib/main/context/ClipboardContext.test.ts`
Expected: FAIL — `Cannot find module './ClipboardContext'`

- [ ] **Step 3: Écrire `lib/main/context/ClipboardContext.ts`**

```typescript
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
    console.log('[ClipboardContext] Clipboard still holds our own last insert, skipping')
    return ''
  }

  if (trimmed.length <= maxChars) return trimmed

  const cut = trimmed.slice(0, maxChars)
  const lastSpace = cut.lastIndexOf(' ')
  const body = lastSpace > maxChars * 0.8 ? cut.slice(0, lastSpace) : cut
  return `${body}\n[truncated]`
}
```

- [ ] **Step 4: Brancher les trois contextes dans `ContextGrabber`**

```typescript
    const [contextText, clipboardText] = await Promise.all([
      mode.contextSelection ? this.getSelectedText() : Promise.resolve(''),
      Promise.resolve(mode.contextClipboard ? readClipboardText() : ''),
    ])
```

et n'appeler `getWindowContext()` que si `mode.contextApplication` :

```typescript
    const { windowTitle, appName } = mode.contextApplication
      ? await timingCollector.timeAsync(
          TimingEventName.WINDOW_CONTEXT_GATHER,
          async () => await this.getWindowContext(),
        )
      : { windowTitle: '', appName: '' }
```

> Ne pas lire ce dont le mode n'a pas besoin est un gain de latence réel : la lecture de la fenêtre active prend un aller-retour natif, et celle du texte sélectionné peut coûter jusqu'à une seconde d'attente de relâchement des touches.

- [ ] **Step 4bis: Brancher la mémoire d'insertion**

Dans `lib/main/itoSessionManager.ts`, juste après chaque insertion réussie — les deux branches, insertion au curseur et copie au presse-papier :

```typescript
      rememberInsertedText(textToInsert)
```

Sans cet appel, la garde de `readClipboardText` ne se déclenche jamais et le mode de synthèse se relit lui-même. Ajouter un test dans `lib/main/itoSessionManager.test.ts` :

```typescript
  test('what was inserted is remembered, so the clipboard context can skip it', async () => {
    await session.completeSession()
    expect(mockRememberInsertedText).toHaveBeenCalledWith('adjusted transcript')
  })
```

- [ ] **Step 5: Lancer les tests**

```bash
bun test --preload lib/__tests__/setup.ts lib/main/context/ClipboardContext.test.ts
bun test --preload lib/__tests__/setup.ts lib/main/itoStreamController.test.ts
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/main/context/
git commit -m "feat(modes): clipboard context and per-mode context switches"
```

---

### Task 2.4 : Assemblage complet du prompt

**Files:**
- Modify: `lib/main/modes/promptBuilder.ts` (remplace la version minimale du lot 1)
- Test: `lib/main/modes/promptBuilder.test.ts`

**Interfaces:**
- Consumes: `ModeExamplesTable.findByMode`
- Produces: `buildMessages(transcript: string, mode: Mode, context: ContextData): Promise<ChatMessage[]>`

**Forme de la conversation produite :**

```
system     : <instructions>  +  "Always write the result in <langue>."   (sauf `auto`)
user       : <spoken_input de l'exemple 1>
assistant  : <ai_output de l'exemple 1>
…
user       : <blocs de contexte>  +  <dictée>
```

- [ ] **Step 1: Écrire le test qui échoue**

```typescript
// lib/main/modes/promptBuilder.test.ts
import { describe, test, expect, mock, beforeEach } from 'bun:test'

let examples: any[] = []
mock.module('./ModeRepository', () => ({
  ModeExamplesTable: { findByMode: async () => examples },
}))

const { buildMessages } = await import('./promptBuilder')

const mode = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 'intelligent',
    name: 'Intelligent',
    instructions: '## Role\nYou format text.',
    language: 'fr',
    useLlm: true,
    contextApplication: false,
    contextClipboard: false,
    contextSelection: false,
    ...overrides,
  }) as any

const context = (overrides: Record<string, unknown> = {}) =>
  ({
    vocabularyWords: [],
    dictionaryEntries: [],
    windowTitle: '',
    appName: '',
    contextText: '',
    clipboardText: '',
    advancedSettings: {},
    ...overrides,
  }) as any

describe('buildMessages', () => {
  beforeEach(() => {
    examples = []
  })

  test('instructions go to the system message, the dictation is the last user message', async () => {
    const messages = await buildMessages('hello there', mode(), context())

    expect(messages[0].role).toBe('system')
    expect(messages[0].content).toContain('## Role')
    expect(messages.at(-1)).toEqual({ role: 'user', content: 'hello there' })
  })

  test('an explicit language is imposed on the output', async () => {
    const messages = await buildMessages('x', mode({ language: 'es' }), context())
    expect(messages[0].content).toContain('Always write the result in Spanish')
  })

  test('automatic imposes nothing and asks for the dictated language', async () => {
    const messages = await buildMessages('x', mode({ language: 'auto' }), context())
    expect(messages[0].content).not.toContain('Always write the result in')
    expect(messages[0].content).toContain('same language as the user message')
  })

  test('examples become real conversation turns, in order, before the dictation', async () => {
    examples = [
      { spokenInput: 'buy milk eggs no not eggs cheese', aiOutput: '- Milk\n- Cheese' },
      { spokenInput: 'write an article no an essay', aiOutput: 'Write an essay.' },
    ]

    const messages = await buildMessages('x', mode(), context())

    expect(messages.map(m => m.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
      'assistant',
      'user',
    ])
    expect(messages[1].content).toBe('buy milk eggs no not eggs cheese')
    expect(messages[2].content).toBe('- Milk\n- Cheese')
    expect(messages.at(-1)!.content).toBe('x')
  })

  test('an example missing one half is dropped rather than teaching an empty answer', async () => {
    examples = [
      { spokenInput: 'complete', aiOutput: 'ok' },
      { spokenInput: 'orphan', aiOutput: '   ' },
      { spokenInput: '', aiOutput: 'orphan too' },
    ]

    const messages = await buildMessages('x', mode(), context())
    expect(messages.map(m => m.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
    ])
  })

  test('enabled contexts are labelled and precede the dictation in the same message', async () => {
    const messages = await buildMessages(
      'continue this',
      mode({
        contextApplication: true,
        contextClipboard: true,
        contextSelection: true,
      }),
      context({
        appName: 'Cursor',
        windowTitle: 'plan.md',
        clipboardText: 'clip',
        contextText: 'selected',
      }),
    )

    const last = messages.at(-1)!.content
    expect(last).toContain('<application_context>')
    expect(last).toContain('Cursor')
    expect(last).toContain('plan.md')
    expect(last).toContain('<copied_text>')
    expect(last).toContain('clip')
    expect(last).toContain('<selected_text>')
    expect(last).toContain('selected')
    // La dictée ferme le message : c'est elle que le modèle doit traiter.
    expect(last.trimEnd().endsWith('continue this')).toBe(true)
  })

  test('a context that is switched on but empty adds no block', async () => {
    const messages = await buildMessages(
      'x',
      mode({ contextClipboard: true }),
      context({ clipboardText: '' }),
    )
    expect(messages.at(-1)!.content).not.toContain('<copied_text>')
  })

  test('empty instructions fall back rather than sending an empty system message', async () => {
    const messages = await buildMessages('x', mode({ instructions: '' }), context())
    expect(messages[0].content.length).toBeGreaterThan(20)
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `bun test --preload lib/__tests__/setup.ts lib/main/modes/promptBuilder.test.ts`
Expected: FAIL — les exemples et les contextes ne sont pas assemblés

- [ ] **Step 3: Réécrire `lib/main/modes/promptBuilder.ts`**

```typescript
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

function buildUserMessage(transcript: string, mode: Mode, context: ContextData) {
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
```

> `ChatMessage` n'accepte aujourd'hui que `'system' | 'user'`. Élargir le type dans `lib/main/transcription/OpenRouterChatService.ts` **et** dans `ChatCompletionOptions` de `lib/main/transcription/LocalTranscriptionService.ts` : `role: 'system' | 'user' | 'assistant'`.

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `bun test --preload lib/__tests__/setup.ts lib/main/modes/promptBuilder.test.ts`
Expected: PASS — 8 tests

- [ ] **Step 5: Vérifier que les deux clients acceptent le rôle assistant**

```bash
grep -n "role" lib/main/transcription/OpenRouterChatService.ts lib/main/transcription/LocalTranscriptionService.ts
bunx tsc --noEmit -p tsconfig.node.json
```
Expected: 0 erreur

- [ ] **Step 6: Commit**

```bash
git add lib/main/modes/promptBuilder.ts lib/main/modes/promptBuilder.test.ts lib/main/transcription/
git commit -m "feat(modes): assemble the prompt from instructions, examples and contexts"
```

---

### Task 2.5 : Interrupteurs de contexte et éditeur d'exemples

**Files:**
- Create: `app/components/home/contents/modes/ContextToggles.tsx`
- Create: `app/components/home/contents/modes/ExamplesEditor.tsx`
- Modify: `app/components/home/contents/modes/ModeEditor.tsx`

- [ ] **Step 1: Écrire `ContextToggles.tsx`**

```tsx
import { usePlatform } from '@/app/hooks/usePlatform'
import { SettingsNote } from '@/app/components/ui/settings'
import type { ModeDto } from '@/app/index'

/**
 * Les trois contextes injectables.
 *
 * Deux honnêtetés délibérées dans les libellés : « Application » ne promet que
 * le titre de fenêtre et le nom de l'app — Ito ne sait pas lire le contenu
 * d'une fenêtre sous Windows — et « Selected text » annonce sa limite plutôt
 * que d'échouer silencieusement dans un terminal.
 */
export default function ContextToggles({
  mode,
  onChange,
}: {
  mode: ModeDto
  onChange: (patch: Record<string, unknown>) => void
}) {
  const platform = usePlatform()

  const items = [
    {
      key: 'contextApplication' as const,
      label: 'Application',
      hint: 'Window title and app name',
      value: mode.contextApplication,
    },
    {
      key: 'contextClipboard' as const,
      label: 'Copied text',
      hint: 'Whatever is in the clipboard',
      value: mode.contextClipboard,
    },
    {
      key: 'contextSelection' as const,
      label: 'Selected text',
      hint: 'The highlighted text, when the app allows reading it',
      value: mode.contextSelection,
    },
  ]

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-4">
        {items.map(item => (
          <label
            key={item.key}
            className="flex cursor-pointer items-start gap-2"
            title={item.hint}
          >
            <input
              type="checkbox"
              checked={item.value}
              onChange={event =>
                onChange({ [item.key]: event.target.checked })
              }
              className="mt-0.5 size-3.5 accent-[var(--foreground)]"
            />
            <span className="text-[11px] leading-snug text-foreground">
              {item.label}
              <span className="block text-[10px] text-[var(--subtle-foreground)]">
                {item.hint}
              </span>
            </span>
          </label>
        ))}
      </div>

      {mode.contextSelection && platform === 'win32' && (
        <SettingsNote>
          On Windows, reading the selection is skipped in terminals — the
          simulated copy would interrupt whatever is running.
        </SettingsNote>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Écrire `ExamplesEditor.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { Button } from '@/app/components/ui/button'
import { Textarea } from '@/app/components/ui/textarea'
import { SettingsCard, SettingsNote } from '@/app/components/ui/settings'
import type { ModeExampleDto } from '@/app/index'

/**
 * Les exemples few-shot d'un mode.
 *
 * C'est le seul moyen de rattraper un modèle qui *répond* à la dictée au lieu
 * de la reformater : lui montrer une fois la sortie attendue vaut mieux que
 * dix lignes d'instruction supplémentaires. Le chemin le plus court pour en
 * ajouter un est le bouton « Add as example » de l'historique, qui préremplit
 * la moitié gauche avec la dictée qui a échoué.
 */
export default function ExamplesEditor({ modeId }: { modeId: string }) {
  const [examples, setExamples] = useState<ModeExampleDto[]>([])
  const [drafts, setDrafts] = useState<Record<string, { spoken: string; ai: string }>>({})

  const load = async () => {
    const list = await window.api.modes.examples.get(modeId)
    setExamples(list)
    setDrafts(
      Object.fromEntries(
        list.map(e => [e.id, { spoken: e.spokenInput, ai: e.aiOutput }]),
      ),
    )
  }

  useEffect(() => {
    void load()
  }, [modeId])

  const add = async () => {
    await window.api.modes.examples.add(modeId, '', '')
    await load()
  }

  const save = async (id: string) => {
    const draft = drafts[id]
    if (!draft) return
    await window.api.modes.examples.update(id, draft.spoken, draft.ai)
  }

  const remove = async (id: string) => {
    await window.api.modes.examples.delete(id)
    await load()
  }

  return (
    <SettingsCard
      title="Examples"
      description="Show the model what a good result looks like. The dictation on the left, the wanted output on the right."
      action={
        <Button variant="outline" size="sm" onClick={add}>
          Add example
        </Button>
      }
    >
      {examples.length === 0 && (
        <SettingsNote>
          No example yet. If this mode answers your dictation instead of
          formatting it, one example usually fixes it.
        </SettingsNote>
      )}

      <div className="space-y-3">
        {examples.map(example => (
          <div key={example.id} className="grid grid-cols-2 gap-2">
            <Textarea
              rows={3}
              placeholder="What you said"
              value={drafts[example.id]?.spoken ?? ''}
              onChange={event =>
                setDrafts(previous => ({
                  ...previous,
                  [example.id]: {
                    spoken: event.target.value,
                    ai: previous[example.id]?.ai ?? '',
                  },
                }))
              }
              onBlur={() => void save(example.id)}
            />
            <div className="space-y-1">
              <Textarea
                rows={3}
                placeholder="What it should produce"
                value={drafts[example.id]?.ai ?? ''}
                onChange={event =>
                  setDrafts(previous => ({
                    ...previous,
                    [example.id]: {
                      spoken: previous[example.id]?.spoken ?? '',
                      ai: event.target.value,
                    },
                  }))
                }
                onBlur={() => void save(example.id)}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => void remove(example.id)}
              >
                Remove
              </Button>
            </div>
          </div>
        ))}
      </div>
    </SettingsCard>
  )
}
```

- [ ] **Step 3: Brancher les deux dans `ModeEditor`**

Sous le `SettingsCard` des instructions, dans le bloc `mode.useLlm` :

```tsx
          <div className="mb-3">
            <div className="mb-1.5 text-xs font-medium text-foreground">
              Context
            </div>
            <ContextToggles mode={mode} onChange={set} />
          </div>

          <ExamplesEditor modeId={mode.id} />
```

- [ ] **Step 4: Vérifier visuellement**

Run: `bun dev`

1. Ouvrir Modes → Intelligent : les trois cases de contexte apparaissent, « Application » cochée.
2. Ajouter un exemple, remplir les deux moitiés, quitter le champ → recharger la page, l'exemple est là.
3. Cocher « Copied text », copier un texte, dicter « résume ça » → le résultat tient compte du presse-papier.

- [ ] **Step 5: Commit**

```bash
git add app/components/home/contents/modes/
git commit -m "feat(modes): context switches and few-shot example editor"
```

---

### Task 2.6 : « Add as example » depuis l'historique

**Files:**
- Modify: `app/components/home/contents/HomeContent.tsx`
- Create: `app/components/home/contents/history/AddAsExampleDialog.tsx`

- [ ] **Step 1: Écrire le dialogue**

```tsx
import { useEffect, useState } from 'react'
import { useModesStore } from '@/app/store/useModesStore'
import { Button } from '@/app/components/ui/button'
import { Textarea } from '@/app/components/ui/textarea'
import { SettingsNote, CONTROL_WIDTH } from '@/app/components/ui/settings'
import { cn } from '@/lib/utils'

/**
 * Transforme une dictée ratée en exemple.
 *
 * La moitié gauche est le transcript **brut** — c'est ce que le modèle a
 * réellement reçu, et donc ce qu'il faut lui réapprendre à traiter. La moitié
 * droite est préremplie avec le résultat obtenu, à corriger : partir du
 * mauvais résultat demande moins d'effort que partir d'une page blanche.
 */
export default function AddAsExampleDialog({
  rawTranscript,
  currentResult,
  defaultModeId,
  onClose,
}: {
  rawTranscript: string
  currentResult: string
  defaultModeId: string | null
  onClose: () => void
}) {
  const { modes, loaded, load } = useModesStore()
  const [modeId, setModeId] = useState(defaultModeId ?? '')
  const [spoken, setSpoken] = useState(rawTranscript)
  const [output, setOutput] = useState(currentResult)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  useEffect(() => {
    if (!modeId && modes.length) setModeId(modes[0].id)
  }, [modes, modeId])

  const save = async () => {
    if (!modeId || !spoken.trim() || !output.trim()) return
    await window.api.modes.examples.add(modeId, spoken.trim(), output.trim())
    setSaved(true)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
      <div className="surface-1 w-full max-w-[520px] rounded-xl p-4">
        <h3 className="font-heading mb-1 text-xs font-semibold text-foreground">
          Add as example
        </h3>
        <p className="mb-3 text-[11px] leading-snug text-[var(--subtle-foreground)]">
          Correct the result on the right. Next time this mode sees a dictation
          like the one on the left, it will know what to produce.
        </p>

        <select
          value={modeId}
          onChange={event => setModeId(event.target.value)}
          className={cn(
            'mb-3 rounded-lg border border-border bg-transparent px-2 py-1 text-xs text-foreground',
            CONTROL_WIDTH,
          )}
        >
          {modes
            .filter(mode => mode.useLlm)
            .map(mode => (
              <option key={mode.id} value={mode.id}>
                {mode.name}
              </option>
            ))}
        </select>

        <div className="grid grid-cols-2 gap-2">
          <Textarea
            rows={6}
            value={spoken}
            onChange={event => setSpoken(event.target.value)}
          />
          <Textarea
            rows={6}
            value={output}
            onChange={event => setOutput(event.target.value)}
          />
        </div>

        {saved && <SettingsNote>Example added.</SettingsNote>}

        <div className="mt-3 flex gap-2">
          <Button size="sm" onClick={save} disabled={saved}>
            {saved ? 'Added' : 'Add example'}
          </Button>
          <Button variant="outline" size="sm" onClick={onClose}>
            {saved ? 'Close' : 'Cancel'}
          </Button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Ajouter le déclencheur dans l'historique**

Dans `HomeContent.tsx` :

```tsx
  const [exampleFor, setExampleFor] = useState<Interaction | null>(null)
```

Dans la ligne, à côté de « Show original » :

```tsx
                            {interaction.asr_output?.rawTranscript && (
                              <button
                                type="button"
                                onClick={() => setExampleFor(interaction)}
                                className="text-[11px] text-muted-foreground/70 underline-offset-2 hover:text-foreground hover:underline"
                              >
                                Add as example
                              </button>
                            )}
```

et en fin de composant :

```tsx
      {exampleFor && (
        <AddAsExampleDialog
          rawTranscript={exampleFor.asr_output?.rawTranscript ?? ''}
          currentResult={exampleFor.asr_output?.transcript ?? ''}
          defaultModeId={exampleFor.asr_output?.modeId ?? null}
          onClose={() => setExampleFor(null)}
        />
      )}
```

> Le bouton n'apparaît que sur les lignes qui ont un transcript brut, c'est-à-dire celles produites par un mode qui réécrit. Sur une ligne Voice to text, un exemple n'aurait aucun sens : il n'y a pas de modèle à corriger.

- [ ] **Step 3: Vérifier visuellement**

Run: `bun dev`

1. Dicter en mode Intelligent une phrase avec une autocorrection (« il faut détecter, non, il faut que ça marche »).
2. Si le résultat garde l'hésitation, cliquer « Add as example », corriger la droite, ajouter.
3. Ouvrir Modes → Intelligent : l'exemple est dans la liste.
4. Redicter la même phrase → le résultat suit l'exemple.

- [ ] **Step 4: Commit**

```bash
git add app/components/home/contents/
git commit -m "feat(history): turn a failed dictation into a mode example"
```

---

## Vérification du lot 2

```bash
for f in \
  lib/main/context/ClipboardContext.test.ts \
  lib/main/modes/promptBuilder.test.ts \
  lib/main/interactions/InteractionManager.test.ts \
  lib/main/itoStreamController.test.ts ; do
  echo "--- $f"; bun test --preload lib/__tests__/setup.ts "$f" 2>&1 | tail -4
done
bunx tsc --noEmit -p tsconfig.node.json
bunx electron-vite build
```

**Critère de sortie :** deux modes avec des instructions différentes produisent des textes différents sur la même dictée, et un exemple ajouté depuis l'historique change le résultat de la dictée suivante.
