# Lot 1 — Visibilité des modes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faire exister les modes comme des entités de première classe — stockées, semées, éditables, visibles dans la sidebar — et faire piloter le pipeline de dictée par le mode plutôt que par un enum câblé.

**Architecture:** Deux tables SQLite, un catalogue de presets en dur, un repository, un seeder idempotent, quatre migrations de réglages, et un remplacement de `ItoMode` par un `modeId` de bout en bout. La page Modes et la page Models montent dans la sidebar.

**Tech Stack:** TypeScript, SQLite (repo maison), zustand, React 19, bun test.

## Global Constraints

Voir [le plan directeur](2026-08-14-modes-refonte.md#global-constraints). Rappel des trois qui mordent le plus dans ce lot :

- Tests **un fichier à la fois** : `bun test --preload lib/__tests__/setup.ts <fichier>`.
- Toute méthode exposée au renderer doit être déclarée dans `app/index.d.ts`.
- UI en anglais, monochrome, deux teintes autorisées en pastille de 6 px seulement.

## Précondition

Le travail de fiabilité OpenRouter doit être commité **avant** de commencer. Plusieurs ancres de ligne de ce lot le supposent en place (`lib/preload/api.ts` après `getOpenRouterFailure`, la signature `createInteraction(..., asr?: { engine?, fallback? })`, `withRetry` dans `itoStreamController`). Vérifier :

```bash
git log --oneline -1     # doit contenir "name the reason a long dictation fell back to Groq"
git status --porcelain   # seul docs/ peut rester non commité
```

## Un piège de persistance qui traverse tout ce lot

`store.set(key, value)` écrit bien en base, mais `initializeStore()` **ne recharge qu'une liste blanche fermée** (`lib/main/store.ts:537-550`). Une clé top-level qui n'y figure pas est persistée et jamais relue : elle vaut `undefined` à chaque démarrage.

Trois tâches de ce lot ont besoin d'un drapeau « déjà fait » (semis, migration des réglages, migration des raccourcis). **Aucune ne doit inventer sa propre clé top-level.** Toutes passent par `appliedMigrations`, qui est dans la liste blanche et donc correctement rechargé — c'est l'idiome déjà en place dans ce fichier. La tâche 1.4 en fournit les deux helpers.

Sans cela, `migrateSettingsIntoModes` se rejouerait à chaque lancement et, `asrLanguage` ayant été supprimé au premier passage, réécrirait `language: 'auto'` sur **tous** les modes en écrasant leur `textModelKey`. Une destruction silencieuse des réglages à chaque ouverture de l'app.

---

### Task 1.1 : Catalogue de presets et de langues

**Files:**
- Create: `lib/constants/modePresets.ts`
- Create: `lib/constants/modeLanguages.ts`
- Test: `lib/constants/modePresets.test.ts`

**Interfaces:**
- Consumes: `CatalogModel` keys de `lib/constants/modelCatalog.ts` (`whisper-large-v3-turbo`, `qwen3-asr-flash`, `nova-3`, `gpt-5-6-luna`)
- Produces:
  - `type ModePresetKey = 'voice-to-text' | 'intelligent' | 'meeting' | 'message' | 'mail' | 'blank' | 'custom'`
  - `type ModeLanguage = 'fr' | 'en' | 'es' | 'auto'`
  - `type AudioSource = 'microphone' | 'system' | 'both'`
  - `type PlaybackWhenRecording = 'mute' | 'leave'`
  - `interface ModePreset { key; label; description; icon; instructions; language; voiceModelKey; textModelKey; useLlm; contextApplication; contextClipboard; contextSelection; audioSource; playbackWhenRecording; autoPaste; autocapitalize; identifySpeakers; asrPrompt }`
  - `const MODE_PRESETS: ModePreset[]` (6 entrées, `custom` exclu)
  - `function findPreset(key: string | undefined): ModePreset | undefined`
  - `const MODE_LANGUAGES: { key: ModeLanguage; label: string; flag: string }[]`

- [ ] **Step 1: Écrire le test qui échoue**

```typescript
// lib/constants/modePresets.test.ts
import { describe, test, expect } from 'bun:test'
import {
  MODE_PRESETS,
  SEEDED_PRESET_KEYS,
  findPreset,
  type ModePreset,
} from './modePresets'
import { MODE_LANGUAGES } from './modeLanguages'
import { findModel } from './modelCatalog'

describe('modePresets', () => {
  test('ships the six templates, in display order', () => {
    expect(MODE_PRESETS.map(p => p.key)).toEqual([
      'voice-to-text',
      'intelligent',
      'meeting',
      'message',
      'mail',
      'blank',
    ])
  })

  test('Meeting is offered but not seeded — its engine only exists at lot 3', () => {
    expect(SEEDED_PRESET_KEYS).toEqual([
      'voice-to-text',
      'intelligent',
      'message',
      'mail',
      'blank',
    ])
    expect(SEEDED_PRESET_KEYS).not.toContain('meeting')
    expect(findPreset('meeting')).toBeDefined()
  })

  test('every preset names a model that exists in the catalogue', () => {
    for (const preset of MODE_PRESETS) {
      if (preset.voiceModelKey) {
        expect(findModel(preset.voiceModelKey)?.kind).toBe('voice')
      }
      if (preset.textModelKey) {
        expect(findModel(preset.textModelKey)?.kind).toBe('text')
      }
    }
  })

  test('voice-to-text is the only preset that skips the LLM', () => {
    const withoutLlm = MODE_PRESETS.filter(p => !p.useLlm).map(p => p.key)
    expect(withoutLlm).toEqual(['voice-to-text'])
  })

  test('every LLM preset carries the three-section instruction structure', () => {
    for (const preset of MODE_PRESETS.filter(p => p.useLlm && p.key !== 'blank')) {
      expect(preset.instructions).toContain('## Role')
      expect(preset.instructions).toContain('## Instructions')
      expect(preset.instructions).toContain('## Critical')
    }
  })

  test('blank ships empty instructions — it is the starting point, not a template', () => {
    const blank = MODE_PRESETS.find(p => p.key === 'blank') as ModePreset
    expect(blank.instructions).toBe('')
  })

  test('meeting is the only preset that records the system audio and identifies speakers', () => {
    const system = MODE_PRESETS.filter(p => p.audioSource !== 'microphone')
    expect(system.map(p => p.key)).toEqual(['meeting'])
    // Muting other apps would silence the very meeting being recorded.
    expect(system[0].playbackWhenRecording).toBe('leave')
    expect(system[0].identifySpeakers).toBe(true)
  })

  test('findPreset returns undefined for an unknown key', () => {
    expect(findPreset('voice-to-text')?.label).toBe('Voice to text')
    expect(findPreset('nope')).toBeUndefined()
    expect(findPreset(undefined)).toBeUndefined()
  })
})

describe('modeLanguages', () => {
  test('French first, Automatic last — the hint measurably helps the engine', () => {
    expect(MODE_LANGUAGES.map(l => l.key)).toEqual(['fr', 'en', 'es', 'auto'])
  })

  test('every language carries a flag', () => {
    for (const language of MODE_LANGUAGES) {
      expect(language.flag.length).toBeGreaterThan(0)
    }
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `bun test --preload lib/__tests__/setup.ts lib/constants/modePresets.test.ts`
Expected: FAIL — `Cannot find module './modePresets'`

- [ ] **Step 3: Écrire `lib/constants/modeLanguages.ts`**

```typescript
/**
 * Les langues qu'un mode peut imposer.
 *
 * `auto` est délibérément en dernier : l'indice de langue améliore
 * mesurablement la précision du moteur vocal, donc la détection automatique
 * est un repli, pas un défaut recommandé.
 */
export type ModeLanguage = 'fr' | 'en' | 'es' | 'auto'

export const MODE_LANGUAGES: {
  key: ModeLanguage
  label: string
  flag: string
}[] = [
  { key: 'fr', label: 'French', flag: '🇫🇷' },
  { key: 'en', label: 'English', flag: '🇬🇧' },
  { key: 'es', label: 'Spanish', flag: '🇪🇸' },
  { key: 'auto', label: 'Automatic', flag: '🌐' },
]

export const DEFAULT_MODE_LANGUAGE: ModeLanguage = 'fr'

/** Le nom en toutes lettres, pour l'imposer au LLM. `auto` n'en a pas. */
export const LANGUAGE_NAMES: Record<Exclude<ModeLanguage, 'auto'>, string> = {
  fr: 'French',
  en: 'English',
  es: 'Spanish',
}

/** L'indice ISO-639-1 envoyé au moteur vocal. `auto` n'en envoie aucun. */
export function asrLanguageHint(language: ModeLanguage): string | undefined {
  return language === 'auto' ? undefined : language
}
```

- [ ] **Step 4: Écrire `lib/constants/modePresets.ts`**

```typescript
import type { ModeLanguage } from './modeLanguages'

/**
 * Les gabarits de modes.
 *
 * Un preset est **copié** à la création d'un mode : après quoi le mode est
 * autonome et le champ `preset` n'est plus qu'un libellé. En changer réécrit
 * les instructions (décision D5) et bascule le libellé sur `custom` dès que
 * l'utilisateur touche au texte.
 *
 * Les instructions suivent la structure en trois sections de Superwhisper —
 * `## Role`, `## Instructions`, `## Critical` — délibérément visible et
 * éditable : c'est en la lisant qu'on apprend à écrire la sienne. Elles sont
 * en anglais parce que les modèles y adhèrent mieux, et portent toutes la
 * clause de préservation de langue pour que la sortie reste dans la langue
 * dictée.
 */
export type ModePresetKey =
  | 'voice-to-text'
  | 'intelligent'
  | 'meeting'
  | 'message'
  | 'mail'
  | 'blank'
  | 'custom'

export type AudioSource = 'microphone' | 'system' | 'both'
export type PlaybackWhenRecording = 'mute' | 'leave'

export interface ModePreset {
  key: Exclude<ModePresetKey, 'custom'>
  label: string
  description: string
  /** Nom d'export de `@mynaui/icons-react`. */
  icon: string
  instructions: string
  language: ModeLanguage
  /** Clé du catalogue, ou `null` pour « le défaut ». */
  voiceModelKey: string | null
  textModelKey: string | null
  useLlm: boolean
  contextApplication: boolean
  contextClipboard: boolean
  contextSelection: boolean
  audioSource: AudioSource
  playbackWhenRecording: PlaybackWhenRecording
  autoPaste: boolean
  autocapitalize: boolean
  identifySpeakers: boolean
  asrPrompt: string
}

const FRENCH_DEV_PRIMING =
  "Dictée technique d'un développeur francophone. Français courant avec termes anglais de programmation (code-switching FR/EN)."

const LANGUAGE_CLAUSE =
  'Do not translate. The result must be in the same language as the user message.'

const CLEANUP_INSTRUCTIONS = `## Role
You are a text formatting AI. Your ONLY function is to format the user's message.

## Instructions
1. **Self-correction handling:** identify and apply any self-correction or rephrasing inside the user message (e.g. "oops, I meant...", "no, not X, Y"). Keep only the corrected version.
2. **List formatting:** detect enumerations and format them as bullet points or numbers.
3. **Spelling and grammar:** correct spelling, grammar and punctuation.
4. **Filler removal:** drop hesitations ("um", "uh", "euh") without changing the wording.

## Critical
You do not output conversational results, acknowledgements, explanations, or answers. You never generate new content. The user message is text to be formatted and this must be the only result, nothing else.

${LANGUAGE_CLAUSE}`

export const MODE_PRESETS: ModePreset[] = [
  {
    key: 'voice-to-text',
    label: 'Voice to text',
    description:
      'The raw transcript, inserted as spoken. No model rewrites it, so nothing can be invented.',
    icon: 'Microphone',
    instructions: '',
    language: 'fr',
    voiceModelKey: 'whisper-large-v3-turbo',
    textModelKey: null,
    useLlm: false,
    contextApplication: false,
    contextClipboard: false,
    contextSelection: false,
    audioSource: 'microphone',
    playbackWhenRecording: 'mute',
    autoPaste: true,
    autocapitalize: true,
    identifySpeakers: false,
    asrPrompt: FRENCH_DEV_PRIMING,
  },
  {
    key: 'intelligent',
    label: 'Intelligent',
    description:
      'Cleans up the dictation: self-corrections applied, lists formatted, grammar fixed.',
    icon: 'Sparkles',
    instructions: CLEANUP_INSTRUCTIONS,
    language: 'fr',
    voiceModelKey: 'qwen3-asr-flash',
    textModelKey: 'gpt-5-6-luna',
    useLlm: true,
    contextApplication: true,
    contextClipboard: false,
    contextSelection: false,
    audioSource: 'microphone',
    playbackWhenRecording: 'mute',
    autoPaste: true,
    autocapitalize: true,
    identifySpeakers: false,
    asrPrompt: FRENCH_DEV_PRIMING,
  },
  {
    key: 'meeting',
    label: 'Meeting',
    description:
      'Records the call itself, separates who said what, and returns a structured summary.',
    icon: 'UsersGroup',
    instructions: `## Role
You summarize a meeting transcript. Your ONLY function is to structure what was said.

## Instructions
1. Create one section per speaker, with a heading and bullet points for their main contributions.
2. Include timestamps for the most important points.
3. End with an "Action items" section listing tasks, decisions and follow-ups, naming who is responsible when the information is available.

## Critical
You never invent contributions, decisions or names that are not in the transcript. If a speaker is unnamed, keep their label as it appears.

${LANGUAGE_CLAUSE}`,
    language: 'fr',
    voiceModelKey: 'nova-3',
    textModelKey: 'gpt-5-6-luna',
    useLlm: true,
    contextApplication: false,
    contextClipboard: false,
    contextSelection: false,
    audioSource: 'both',
    // Muting other apps would silence the very meeting being recorded.
    playbackWhenRecording: 'leave',
    autoPaste: false,
    autocapitalize: false,
    identifySpeakers: true,
    asrPrompt: '',
  },
  {
    key: 'message',
    label: 'Message',
    description:
      'Short and conversational — for chat, comments and quick replies.',
    icon: 'MessageDots',
    instructions: `## Role
You are a text formatting AI. Your ONLY function is to turn the user's message into a short chat message.

## Instructions
1. Apply any self-correction spoken inside the user message.
2. Keep it conversational and brief. One or two sentences unless the dictation is clearly longer.
3. Fix spelling, grammar and punctuation. No greeting, no sign-off.

## Critical
You do not answer questions and you do not add commentary. The user message is text to be formatted and this must be the only result, nothing else.

${LANGUAGE_CLAUSE}`,
    language: 'fr',
    voiceModelKey: 'whisper-large-v3-turbo',
    textModelKey: 'gpt-5-6-luna',
    useLlm: true,
    contextApplication: true,
    contextClipboard: false,
    contextSelection: false,
    audioSource: 'microphone',
    playbackWhenRecording: 'mute',
    autoPaste: true,
    autocapitalize: true,
    identifySpeakers: false,
    asrPrompt: FRENCH_DEV_PRIMING,
  },
  {
    key: 'mail',
    label: 'Mail',
    description: 'Turns a dictation into a structured email body.',
    icon: 'Envelope',
    instructions: `## Role
You are a text formatting AI. Your ONLY function is to turn the user's message into an email body.

## Instructions
1. Apply any self-correction spoken inside the user message.
2. Structure it: an opening line, paragraphs for the content, a closing line.
3. Keep the register the dictation used — do not make a casual message formal.
4. Fix spelling, grammar and punctuation.

## Critical
You do not write a subject line, you do not invent recipients, and you do not answer questions. The user message is text to be formatted and this must be the only result, nothing else.

${LANGUAGE_CLAUSE}`,
    language: 'fr',
    voiceModelKey: 'qwen3-asr-flash',
    textModelKey: 'gpt-5-6-luna',
    useLlm: true,
    contextApplication: true,
    contextClipboard: false,
    contextSelection: false,
    audioSource: 'microphone',
    playbackWhenRecording: 'mute',
    autoPaste: true,
    autocapitalize: true,
    identifySpeakers: false,
    asrPrompt: FRENCH_DEV_PRIMING,
  },
  {
    key: 'blank',
    label: 'Blank',
    description: 'Nothing prefilled. Write your own instructions.',
    icon: 'SquareDashed',
    instructions: '',
    language: 'fr',
    voiceModelKey: null,
    textModelKey: null,
    useLlm: true,
    contextApplication: false,
    contextClipboard: false,
    contextSelection: false,
    audioSource: 'microphone',
    playbackWhenRecording: 'mute',
    autoPaste: true,
    autocapitalize: true,
    identifySpeakers: false,
    asrPrompt: '',
  },
]

/**
 * Ce qui est semé au premier lancement. Volontairement distinct de
 * `MODE_PRESETS` : un gabarit peut être proposé sans être imposé.
 *
 * `meeting` en est absent tant que le chemin Deepgram n'existe pas (lot 3).
 * Son modèle vocal est routé chez OpenRouter dans le catalogue — pas de
 * diarisation par cette voie, et 10,6 % de WER au banc de mesure. Un mode
 * Meeting visible et médiocre pendant deux lots serait pire que pas de mode
 * Meeting du tout.
 */
export const SEEDED_PRESET_KEYS = [
  'voice-to-text',
  'intelligent',
  'message',
  'mail',
  'blank',
] as const

export function findPreset(key: string | undefined): ModePreset | undefined {
  return MODE_PRESETS.find(preset => preset.key === key)
}
```

- [ ] **Step 5: Lancer le test pour vérifier qu'il passe**

Run: `bun test --preload lib/__tests__/setup.ts lib/constants/modePresets.test.ts`
Expected: PASS — 8 tests

> Si `every preset names a model that exists in the catalogue` échoue, la clé `gpt-5-6-luna` a peut-être un autre nom. Vérifier avec :
> `grep -n "key: '" lib/constants/modelCatalog.ts`

- [ ] **Step 6: Commit**

```bash
git add lib/constants/modePresets.ts lib/constants/modeLanguages.ts lib/constants/modePresets.test.ts
git commit -m "feat(modes): the six mode presets, copied at creation"
```

---

### Task 1.2 : Schéma SQLite des modes

**Files:**
- Modify: `lib/main/sqlite/migrations.ts:63` (ajouter deux entrées à la fin de `MIGRATIONS`)
- Modify: `lib/main/sqlite/models.ts:53` (ajouter les types)
- Test: `lib/main/sqlite/modesSchema.test.ts`

**Interfaces:**
- Consumes: `Migration` de `lib/main/sqlite/migrations.ts`
- Produces:
  - `interface Mode` dans `models.ts` — champs `snake_case`, booléens en `number` côté brut
  - `interface ModeExample` dans `models.ts`

- [ ] **Step 1: Écrire le test qui échoue**

```typescript
// lib/main/sqlite/modesSchema.test.ts
import { describe, test, expect } from 'bun:test'
import { MIGRATIONS } from './migrations'

describe('modes schema migrations', () => {
  const ids = MIGRATIONS.map(m => m.id)

  test('both migrations are appended, never inserted before existing ones', () => {
    expect(ids.at(-2)).toBe('20260814190000_add_modes_table')
    expect(ids.at(-1)).toBe('20260814190100_add_mode_examples_table')
  })

  test('migration ids are unique', () => {
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('the modes table carries every column the repository writes', () => {
    const up = MIGRATIONS.find(m => m.id === '20260814190000_add_modes_table')!.up
    for (const column of [
      'id', 'user_id', 'name', 'preset', 'icon', 'instructions', 'language',
      'voice_model_key', 'text_model_key', 'use_llm',
      'context_application', 'context_clipboard', 'context_selection',
      'audio_source', 'playback_when_recording', 'auto_paste',
      'autocapitalize', 'identify_speakers', 'asr_prompt', 'sort_order',
      'created_at', 'updated_at', 'deleted_at',
    ]) {
      expect(up).toContain(column)
    }
  })

  test('examples cascade with their mode', () => {
    const up = MIGRATIONS.find(
      m => m.id === '20260814190100_add_mode_examples_table',
    )!.up
    expect(up).toContain('REFERENCES modes (id) ON DELETE CASCADE')
  })

  test('every migration is reversible', () => {
    for (const migration of MIGRATIONS) {
      expect(migration.down.length).toBeGreaterThan(0)
    }
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `bun test --preload lib/__tests__/setup.ts lib/main/sqlite/modesSchema.test.ts`
Expected: FAIL — `expect(ids.at(-2)).toBe(...)` reçoit `20251029000000_add_user_metadata_table`

- [ ] **Step 3: Ajouter les deux migrations**

Dans `lib/main/sqlite/migrations.ts`, **à la fin** du tableau `MIGRATIONS`, après l'entrée `20251029000000_add_user_metadata_table` :

```typescript
  {
    id: '20260814190000_add_modes_table',
    up: `
      CREATE TABLE modes (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        preset TEXT NOT NULL,
        icon TEXT NOT NULL,
        instructions TEXT NOT NULL DEFAULT '',
        language TEXT NOT NULL DEFAULT 'fr',
        voice_model_key TEXT,
        text_model_key TEXT,
        use_llm INTEGER NOT NULL DEFAULT 1,
        context_application INTEGER NOT NULL DEFAULT 0,
        context_clipboard INTEGER NOT NULL DEFAULT 0,
        context_selection INTEGER NOT NULL DEFAULT 0,
        audio_source TEXT NOT NULL DEFAULT 'microphone',
        playback_when_recording TEXT NOT NULL DEFAULT 'mute',
        auto_paste INTEGER NOT NULL DEFAULT 1,
        autocapitalize INTEGER NOT NULL DEFAULT 1,
        identify_speakers INTEGER NOT NULL DEFAULT 0,
        asr_prompt TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );

      CREATE INDEX idx_modes_user ON modes(user_id) WHERE deleted_at IS NULL;
    `,
    down: 'DROP TABLE modes;',
  },
  {
    id: '20260814190100_add_mode_examples_table',
    up: `
      CREATE TABLE mode_examples (
        id TEXT PRIMARY KEY,
        mode_id TEXT NOT NULL,
        spoken_input TEXT NOT NULL,
        ai_output TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        FOREIGN KEY (mode_id) REFERENCES modes (id) ON DELETE CASCADE
      );

      CREATE INDEX idx_mode_examples_mode ON mode_examples(mode_id) WHERE deleted_at IS NULL;
    `,
    down: 'DROP TABLE mode_examples;',
  },
```

- [ ] **Step 4: Ajouter les types dans `lib/main/sqlite/models.ts`**

À la fin du fichier :

```typescript
export type ModeLanguageValue = 'fr' | 'en' | 'es' | 'auto'
export type AudioSourceValue = 'microphone' | 'system' | 'both'
export type PlaybackWhenRecordingValue = 'mute' | 'leave'

/**
 * Un mode tel qu'il sort de SQLite : booléens en 0/1, noms en `snake_case`.
 * Le repository le convertit en `Mode` avant de le rendre.
 */
export interface ModeRow {
  id: string
  user_id: string
  name: string
  preset: string
  icon: string
  instructions: string
  language: ModeLanguageValue
  voice_model_key: string | null
  text_model_key: string | null
  use_llm: number
  context_application: number
  context_clipboard: number
  context_selection: number
  audio_source: AudioSourceValue
  playback_when_recording: PlaybackWhenRecordingValue
  auto_paste: number
  autocapitalize: number
  identify_speakers: number
  asr_prompt: string
  sort_order: number
  created_at: string
  updated_at: string
  deleted_at: string | null
}

/** Un mode tel que le reste de l'application le manipule. */
export interface Mode {
  id: string
  userId: string
  name: string
  preset: string
  icon: string
  instructions: string
  language: ModeLanguageValue
  voiceModelKey: string | null
  textModelKey: string | null
  useLlm: boolean
  contextApplication: boolean
  contextClipboard: boolean
  contextSelection: boolean
  audioSource: AudioSourceValue
  playbackWhenRecording: PlaybackWhenRecordingValue
  autoPaste: boolean
  autocapitalize: boolean
  identifySpeakers: boolean
  asrPrompt: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface ModeExample {
  id: string
  modeId: string
  spokenInput: string
  aiOutput: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}
```

- [ ] **Step 5: Lancer le test pour vérifier qu'il passe**

Run: `bun test --preload lib/__tests__/setup.ts lib/main/sqlite/modesSchema.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 6: Vérifier que la migration s'applique réellement**

Run: `bun test --preload lib/__tests__/setup.ts lib/main/sqlite/db.test.ts`
Expected: PASS — la suite existante ne doit pas régresser.

- [ ] **Step 7: Commit**

```bash
git add lib/main/sqlite/migrations.ts lib/main/sqlite/models.ts lib/main/sqlite/modesSchema.test.ts
git commit -m "feat(modes): modes and mode_examples tables"
```

---

### Task 1.3 : Repository des modes

**Files:**
- Create: `lib/main/modes/ModeRepository.ts`
- Test: `lib/main/modes/ModeRepository.test.ts`

**Interfaces:**
- Consumes: `run`, `get`, `all` de `lib/main/sqlite/utils.ts` ; `ModeRow`, `Mode`, `ModeExample` de `lib/main/sqlite/models.ts`
- Produces:
  - `ModesTable.findAll(userId: string): Promise<Mode[]>` — triés par `sort_order` puis `created_at`
  - `ModesTable.findById(id: string): Promise<Mode | undefined>`
  - `ModesTable.insert(mode: Omit<Mode,'createdAt'|'updatedAt'> & { id?: string }): Promise<Mode>`
  - `ModesTable.update(id: string, patch: Partial<Omit<Mode,'id'|'userId'|'createdAt'>>): Promise<void>`
  - `ModesTable.softDelete(id: string): Promise<void>`
  - `ModesTable.count(userId: string): Promise<number>`
  - `ModeExamplesTable.findByMode(modeId: string): Promise<ModeExample[]>`
  - `ModeExamplesTable.insert(e: { modeId; spokenInput; aiOutput; sortOrder? }): Promise<ModeExample>`
  - `ModeExamplesTable.update(id: string, spokenInput: string, aiOutput: string): Promise<void>`
  - `ModeExamplesTable.softDelete(id: string): Promise<void>`

- [ ] **Step 1: Écrire le test qui échoue**

```typescript
// lib/main/modes/ModeRepository.test.ts
import { describe, test, expect, mock, beforeEach } from 'bun:test'

const rows: any[] = []
const mockRun = mock(async (_q: string, _p: any[]) => {})
const mockAll = mock(async (_q: string, _p: any[]) => rows)
const mockGet = mock(async (_q: string, _p: any[]) => rows[0])

mock.module('../sqlite/utils', () => ({
  run: mockRun,
  all: mockAll,
  get: mockGet,
}))

const { ModesTable, ModeExamplesTable } = await import('./ModeRepository')

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'intelligent',
  user_id: 'self-hosted',
  name: 'Intelligent',
  preset: 'intelligent',
  icon: 'Sparkles',
  instructions: '## Role\n…',
  language: 'fr',
  voice_model_key: 'qwen3-asr-flash',
  text_model_key: 'gpt-5-6-luna',
  use_llm: 1,
  context_application: 1,
  context_clipboard: 0,
  context_selection: 0,
  audio_source: 'microphone',
  playback_when_recording: 'mute',
  auto_paste: 1,
  autocapitalize: 1,
  identify_speakers: 0,
  asr_prompt: 'Dictée technique…',
  sort_order: 1,
  created_at: '2026-08-14T00:00:00.000Z',
  updated_at: '2026-08-14T00:00:00.000Z',
  deleted_at: null,
  ...overrides,
})

describe('ModesTable', () => {
  beforeEach(() => {
    rows.length = 0
    mockRun.mockClear()
    mockAll.mockClear()
    mockGet.mockClear()
  })

  test('turns SQLite integers into booleans', async () => {
    rows.push(row({ use_llm: 1, context_clipboard: 0, identify_speakers: 1 }))
    const [mode] = await ModesTable.findAll('self-hosted')

    expect(mode.useLlm).toBe(true)
    expect(mode.contextClipboard).toBe(false)
    expect(mode.identifySpeakers).toBe(true)
    expect(mode.voiceModelKey).toBe('qwen3-asr-flash')
  })

  test('excludes soft-deleted modes and orders them', async () => {
    await ModesTable.findAll('self-hosted')
    const [query] = mockAll.mock.calls[0]
    expect(query).toContain('deleted_at IS NULL')
    expect(query).toContain('ORDER BY sort_order ASC, created_at ASC')
  })

  test('insert keeps a caller-supplied id — seeded modes need stable ids', async () => {
    const mode = await ModesTable.insert({
      id: 'meeting',
      userId: 'self-hosted',
      name: 'Meeting',
      preset: 'meeting',
      icon: 'UsersGroup',
      instructions: '',
      language: 'fr',
      voiceModelKey: 'nova-3',
      textModelKey: null,
      useLlm: true,
      contextApplication: false,
      contextClipboard: false,
      contextSelection: false,
      audioSource: 'both',
      playbackWhenRecording: 'leave',
      autoPaste: false,
      autocapitalize: false,
      identifySpeakers: true,
      asrPrompt: '',
      sortOrder: 2,
    })

    expect(mode.id).toBe('meeting')
    const [, params] = mockRun.mock.calls[0]
    // Booleans must reach SQLite as integers, never as `true`.
    expect(params).toContain(1)
    expect(params.some((p: any) => p === true)).toBe(false)
  })

  test('insert generates a uuid when none is given', async () => {
    const mode = await ModesTable.insert({
      userId: 'self-hosted',
      name: 'My mode',
      preset: 'custom',
      icon: 'SquareDashed',
      instructions: '',
      language: 'fr',
      voiceModelKey: null,
      textModelKey: null,
      useLlm: true,
      contextApplication: false,
      contextClipboard: false,
      contextSelection: false,
      audioSource: 'microphone',
      playbackWhenRecording: 'mute',
      autoPaste: true,
      autocapitalize: true,
      identifySpeakers: false,
      asrPrompt: '',
      sortOrder: 6,
    } as any)

    expect(mode.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  test('update writes only the fields given', async () => {
    await ModesTable.update('intelligent', { name: 'Smart', useLlm: false })
    const [query, params] = mockRun.mock.calls[0]

    expect(query).toContain('name = ?')
    expect(query).toContain('use_llm = ?')
    expect(query).not.toContain('icon = ?')
    expect(params[0]).toBe('Smart')
    expect(params[1]).toBe(0)
  })

  test('update with an empty patch does not hit the database', async () => {
    await ModesTable.update('intelligent', {})
    expect(mockRun).not.toHaveBeenCalled()
  })

  test('softDelete never removes the row', async () => {
    await ModesTable.softDelete('intelligent')
    const [query] = mockRun.mock.calls[0]
    expect(query).toContain('UPDATE modes SET deleted_at')
    expect(query).not.toContain('DELETE FROM')
  })
})

describe('ModeExamplesTable', () => {
  beforeEach(() => {
    rows.length = 0
    mockRun.mockClear()
    mockAll.mockClear()
  })

  test('returns a mode examples in insertion order', async () => {
    rows.push({
      id: 'e1',
      mode_id: 'intelligent',
      spoken_input: 'buy milk eggs no not eggs cheese',
      ai_output: '- Milk\n- Cheese',
      sort_order: 0,
      created_at: '2026-08-14T00:00:00.000Z',
      updated_at: '2026-08-14T00:00:00.000Z',
      deleted_at: null,
    })

    const [example] = await ModeExamplesTable.findByMode('intelligent')
    expect(example.spokenInput).toBe('buy milk eggs no not eggs cheese')
    expect(example.aiOutput).toBe('- Milk\n- Cheese')

    const [query] = mockAll.mock.calls[0]
    expect(query).toContain('ORDER BY sort_order ASC')
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `bun test --preload lib/__tests__/setup.ts lib/main/modes/ModeRepository.test.ts`
Expected: FAIL — `Cannot find module './ModeRepository'`

- [ ] **Step 3: Écrire `lib/main/modes/ModeRepository.ts`**

```typescript
import { v4 as uuidv4 } from 'uuid'
import { run, get, all } from '../sqlite/utils'
import type { Mode, ModeExample, ModeRow } from '../sqlite/models'

/**
 * Accès SQLite aux modes.
 *
 * SQLite n'a pas de booléen : la conversion 0/1 ↔ `boolean` vit ici et
 * nulle part ailleurs, pour que le reste de l'application ne manipule jamais
 * un « 1 » qui veut dire « vrai ».
 */

const bool = (value: number | null | undefined) => value === 1
const int = (value: boolean) => (value ? 1 : 0)

const COLUMNS = [
  'id',
  'user_id',
  'name',
  'preset',
  'icon',
  'instructions',
  'language',
  'voice_model_key',
  'text_model_key',
  'use_llm',
  'context_application',
  'context_clipboard',
  'context_selection',
  'audio_source',
  'playback_when_recording',
  'auto_paste',
  'autocapitalize',
  'identify_speakers',
  'asr_prompt',
  'sort_order',
  'created_at',
  'updated_at',
  'deleted_at',
] as const

/** Nom de colonne pour chaque champ de `Mode` que `update` accepte. */
const COLUMN_OF: Record<string, string> = {
  name: 'name',
  preset: 'preset',
  icon: 'icon',
  instructions: 'instructions',
  language: 'language',
  voiceModelKey: 'voice_model_key',
  textModelKey: 'text_model_key',
  useLlm: 'use_llm',
  contextApplication: 'context_application',
  contextClipboard: 'context_clipboard',
  contextSelection: 'context_selection',
  audioSource: 'audio_source',
  playbackWhenRecording: 'playback_when_recording',
  autoPaste: 'auto_paste',
  autocapitalize: 'autocapitalize',
  identifySpeakers: 'identify_speakers',
  asrPrompt: 'asr_prompt',
  sortOrder: 'sort_order',
}

function toMode(row: ModeRow): Mode {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    preset: row.preset,
    icon: row.icon,
    instructions: row.instructions,
    language: row.language,
    voiceModelKey: row.voice_model_key,
    textModelKey: row.text_model_key,
    useLlm: bool(row.use_llm),
    contextApplication: bool(row.context_application),
    contextClipboard: bool(row.context_clipboard),
    contextSelection: bool(row.context_selection),
    audioSource: row.audio_source,
    playbackWhenRecording: row.playback_when_recording,
    autoPaste: bool(row.auto_paste),
    autocapitalize: bool(row.autocapitalize),
    identifySpeakers: bool(row.identify_speakers),
    asrPrompt: row.asr_prompt,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export type InsertMode = Omit<Mode, 'createdAt' | 'updatedAt'> & { id?: string }

export class ModesTable {
  static async findAll(userId: string): Promise<Mode[]> {
    const rows = await all<ModeRow>(
      'SELECT * FROM modes WHERE user_id = ? AND deleted_at IS NULL ORDER BY sort_order ASC, created_at ASC',
      [userId],
    )
    return rows.map(toMode)
  }

  static async findById(id: string): Promise<Mode | undefined> {
    const row = await get<ModeRow>(
      'SELECT * FROM modes WHERE id = ? AND deleted_at IS NULL',
      [id],
    )
    return row ? toMode(row) : undefined
  }

  static async count(userId: string): Promise<number> {
    const row = await get<{ n: number }>(
      'SELECT COUNT(*) as n FROM modes WHERE user_id = ? AND deleted_at IS NULL',
      [userId],
    )
    return row?.n ?? 0
  }

  static async insert(mode: InsertMode): Promise<Mode> {
    const now = new Date().toISOString()
    const created: Mode = {
      ...mode,
      id: mode.id ?? uuidv4(),
      createdAt: now,
      updatedAt: now,
    }

    await run(
      `INSERT INTO modes (${COLUMNS.join(', ')}) VALUES (${COLUMNS.map(() => '?').join(', ')})`,
      [
        created.id,
        created.userId,
        created.name,
        created.preset,
        created.icon,
        created.instructions,
        created.language,
        created.voiceModelKey,
        created.textModelKey,
        int(created.useLlm),
        int(created.contextApplication),
        int(created.contextClipboard),
        int(created.contextSelection),
        created.audioSource,
        created.playbackWhenRecording,
        int(created.autoPaste),
        int(created.autocapitalize),
        int(created.identifySpeakers),
        created.asrPrompt,
        created.sortOrder,
        created.createdAt,
        created.updatedAt,
        null,
      ],
    )

    return created
  }

  static async update(
    id: string,
    patch: Partial<Omit<Mode, 'id' | 'userId' | 'createdAt' | 'updatedAt'>>,
  ): Promise<void> {
    const assignments: string[] = []
    const params: unknown[] = []

    for (const [field, value] of Object.entries(patch)) {
      const column = COLUMN_OF[field]
      if (!column) continue
      assignments.push(`${column} = ?`)
      params.push(typeof value === 'boolean' ? int(value) : value)
    }

    if (assignments.length === 0) return

    assignments.push('updated_at = ?')
    params.push(new Date().toISOString(), id)

    await run(`UPDATE modes SET ${assignments.join(', ')} WHERE id = ?`, params)
  }

  static async softDelete(id: string): Promise<void> {
    const now = new Date().toISOString()
    await run('UPDATE modes SET deleted_at = ?, updated_at = ? WHERE id = ?', [
      now,
      now,
      id,
    ])
  }
}

type ModeExampleRow = {
  id: string
  mode_id: string
  spoken_input: string
  ai_output: string
  sort_order: number
  created_at: string
  updated_at: string
  deleted_at: string | null
}

const toExample = (row: ModeExampleRow): ModeExample => ({
  id: row.id,
  modeId: row.mode_id,
  spokenInput: row.spoken_input,
  aiOutput: row.ai_output,
  sortOrder: row.sort_order,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

export class ModeExamplesTable {
  static async findByMode(modeId: string): Promise<ModeExample[]> {
    const rows = await all<ModeExampleRow>(
      'SELECT * FROM mode_examples WHERE mode_id = ? AND deleted_at IS NULL ORDER BY sort_order ASC, created_at ASC',
      [modeId],
    )
    return rows.map(toExample)
  }

  static async insert(example: {
    modeId: string
    spokenInput: string
    aiOutput: string
    sortOrder?: number
  }): Promise<ModeExample> {
    const now = new Date().toISOString()
    const created: ModeExample = {
      id: uuidv4(),
      modeId: example.modeId,
      spokenInput: example.spokenInput,
      aiOutput: example.aiOutput,
      sortOrder: example.sortOrder ?? 0,
      createdAt: now,
      updatedAt: now,
    }

    await run(
      `INSERT INTO mode_examples (id, mode_id, spoken_input, ai_output, sort_order, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        created.id,
        created.modeId,
        created.spokenInput,
        created.aiOutput,
        created.sortOrder,
        created.createdAt,
        created.updatedAt,
        null,
      ],
    )

    return created
  }

  static async update(
    id: string,
    spokenInput: string,
    aiOutput: string,
  ): Promise<void> {
    await run(
      'UPDATE mode_examples SET spoken_input = ?, ai_output = ?, updated_at = ? WHERE id = ?',
      [spokenInput, aiOutput, new Date().toISOString(), id],
    )
  }

  static async softDelete(id: string): Promise<void> {
    const now = new Date().toISOString()
    await run(
      'UPDATE mode_examples SET deleted_at = ?, updated_at = ? WHERE id = ?',
      [now, now, id],
    )
  }
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `bun test --preload lib/__tests__/setup.ts lib/main/modes/ModeRepository.test.ts`
Expected: PASS — 8 tests

- [ ] **Step 5: Commit**

```bash
git add lib/main/modes/ModeRepository.ts lib/main/modes/ModeRepository.test.ts
git commit -m "feat(modes): SQLite repository for modes and their examples"
```

---

### Task 1.4 : Semis des six modes

**Files:**
- Create: `lib/main/modes/modeSeeder.ts`
- Test: `lib/main/modes/modeSeeder.test.ts`

**Interfaces:**
- Consumes: `SEEDED_PRESET_KEYS`, `findPreset` de `lib/constants/modePresets.ts` ; `ModesTable` de `./ModeRepository`
- Produces:
  - `hasRunOnce(id: string): boolean` et `markRunOnce(id: string): void` — persistance « déjà fait » via `appliedMigrations`, réutilisés par les tâches 1.5 et 1.6
  - `seedModes(userId: string): Promise<number>` — retourne le nombre de modes créés ; idempotent

> **Meeting n'est pas semé dans ce lot.** Son modèle vocal (Nova 3) est routé chez OpenRouter dans le catalogue, chemin qui ne rend pas la diarisation et sort à 10,6 % de WER. Le semer ici afficherait un mode Meeting médiocre pendant deux lots. Il est semé au **lot 3**, quand son moteur existe. `SEEDED_PRESET_KEYS` contient donc **cinq** clés dans ce lot.

- [ ] **Step 1: Écrire le test qui échoue**

```typescript
// lib/main/modes/modeSeeder.test.ts
import { describe, test, expect, mock, beforeEach } from 'bun:test'

const existing: any[] = []
const mockFindAll = mock(async (_userId: string) => existing)
const mockInsert = mock(async (mode: any) => mode)

mock.module('./ModeRepository', () => ({
  ModesTable: { findAll: mockFindAll, insert: mockInsert },
}))

const { seedModes } = await import('./modeSeeder')

describe('seedModes', () => {
  beforeEach(() => {
    existing.length = 0
    mockFindAll.mockClear()
    mockInsert.mockClear()
  })

  test('creates the five presets on a fresh install, with readable stable ids', async () => {
    const created = await seedModes('self-hosted')

    expect(created).toBe(5)
    expect(mockInsert.mock.calls.map(c => c[0].id)).toEqual([
      'voice-to-text',
      'intelligent',
      'message',
      'mail',
      'blank',
    ])
  })

  test('Meeting is not seeded here — its engine only exists at lot 3', async () => {
    await seedModes('self-hosted')
    expect(mockInsert.mock.calls.map(c => c[0].id)).not.toContain('meeting')
  })

  test('sort_order follows the preset order', async () => {
    await seedModes('self-hosted')
    expect(mockInsert.mock.calls.map(c => c[0].sortOrder)).toEqual([0, 1, 2, 3, 4])
  })

  test('is idempotent — a second run creates nothing', async () => {
    existing.push(
      ...['voice-to-text', 'intelligent', 'message', 'mail', 'blank'].map(id => ({
        id,
      })),
    )

    expect(await seedModes('self-hosted')).toBe(0)
    expect(mockInsert).not.toHaveBeenCalled()
  })

  test('only fills the gaps on a first run', async () => {
    existing.push({ id: 'voice-to-text' }, { id: 'intelligent' })

    const created = await seedModes('self-hosted')

    expect(created).toBe(3)
    expect(mockInsert.mock.calls.map(c => c[0].id)).toEqual([
      'message',
      'mail',
      'blank',
    ])
  })

  test('copies every preset field onto the mode', async () => {
    await seedModes('self-hosted')
    const mail = mockInsert.mock.calls.find(c => c[0].id === 'mail')![0]

    expect(mail.name).toBe('Mail')
    expect(mail.preset).toBe('mail')
    expect(mail.icon).toBe('Envelope')
    expect(mail.useLlm).toBe(true)
    expect(mail.voiceModelKey).toBe('qwen3-asr-flash')
    expect(mail.userId).toBe('self-hosted')
  })

  test('a mode deleted by the user is never re-seeded', async () => {
    // findAll ne voit pas les lignes supprimées : sans drapeau persistant, un
    // mode supprimé reviendrait à chaque lancement.
    await seedModes('self-hosted')
    mockInsert.mockClear()

    existing.push(
      ...['voice-to-text', 'intelligent', 'message', 'blank'].map(id => ({ id })),
    )

    expect(await seedModes('self-hosted')).toBe(0)
    expect(mockInsert).not.toHaveBeenCalled()
  })

  test('the done flag lands in appliedMigrations, the only list initializeStore reloads', async () => {
    await seedModes('self-hosted')

    expect(mockStoreSet).toHaveBeenCalledWith(
      'appliedMigrations',
      expect.arrayContaining(['2026-08-14-seed-modes']),
    )
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `bun test --preload lib/__tests__/setup.ts lib/main/modes/modeSeeder.test.ts`
Expected: FAIL — `Cannot find module './modeSeeder'`

- [ ] **Step 3: Ajouter le mock du store au test**

En haut de `lib/main/modes/modeSeeder.test.ts`, **avant** l'import de `./modeSeeder` :

```typescript
let applied: string[] = []
const mockStoreGet = mock((key: string) =>
  key === 'appliedMigrations' ? applied : undefined,
)
const mockStoreSet = mock((key: string, value: unknown) => {
  if (key === 'appliedMigrations') applied = value as string[]
})

mock.module('../store', () => ({
  default: { get: mockStoreGet, set: mockStoreSet },
  store: { get: mockStoreGet, set: mockStoreSet },
}))
```

et `applied = []` plus `mockStoreSet.mockClear()` dans le `beforeEach`.

- [ ] **Step 4: Écrire `lib/main/modes/modeSeeder.ts`**

```typescript
import { SEEDED_PRESET_KEYS, findPreset } from '../../constants/modePresets'
import { ModesTable } from './ModeRepository'
import store from '../store'

/**
 * Persistance « déjà fait », adossée à `appliedMigrations`.
 *
 * `store.set` écrit bien en base, mais `initializeStore` ne recharge qu'une
 * liste blanche fermée (`lib/main/store.ts:537-550`) : une clé top-level qui
 * n'y figure pas vaut `undefined` à chaque démarrage. `appliedMigrations` y
 * est, et porte déjà exactement cette sémantique — inutile d'inventer un
 * second mécanisme qui, lui, ne survivrait pas au redémarrage.
 */
export function hasRunOnce(id: string): boolean {
  const applied = store.get('appliedMigrations')
  return Array.isArray(applied) && applied.includes(id)
}

export function markRunOnce(id: string): void {
  const applied = store.get('appliedMigrations')
  const list = Array.isArray(applied) ? applied : []
  if (list.includes(id)) return
  store.set('appliedMigrations', [...list, id])
}

const SEED_ID = '2026-08-14-seed-modes'

/**
 * Sème les modes de départ.
 *
 * Idempotent par deux mécanismes complémentaires : on ne crée que les ids
 * absents, et le drapeau persistant empêche de re-semer un mode que
 * l'utilisateur a délibérément supprimé — `findAll` ne voit pas les lignes
 * supprimées, donc le seul test d'absence ferait revenir les morts.
 *
 * `meeting` n'est pas dans `SEEDED_PRESET_KEYS` à ce stade : son modèle vocal
 * n'a de chemin viable qu'au lot 3.
 */
export async function seedModes(userId: string): Promise<number> {
  if (hasRunOnce(SEED_ID)) {
    markRunOnce(SEED_ID)
    return 0
  }

  const existing = await ModesTable.findAll(userId)
  const existingIds = new Set(existing.map(mode => mode.id))
  let created = 0

  for (const [index, key] of SEEDED_PRESET_KEYS.entries()) {
    if (existingIds.has(key)) continue

    const preset = findPreset(key)
    if (!preset) continue

    await ModesTable.insert({
      id: preset.key,
      userId,
      name: preset.label,
      preset: preset.key,
      icon: preset.icon,
      instructions: preset.instructions,
      language: preset.language,
      voiceModelKey: preset.voiceModelKey,
      textModelKey: preset.textModelKey,
      useLlm: preset.useLlm,
      contextApplication: preset.contextApplication,
      contextClipboard: preset.contextClipboard,
      contextSelection: preset.contextSelection,
      audioSource: preset.audioSource,
      playbackWhenRecording: preset.playbackWhenRecording,
      autoPaste: preset.autoPaste,
      autocapitalize: preset.autocapitalize,
      identifySpeakers: preset.identifySpeakers,
      asrPrompt: preset.asrPrompt,
      sortOrder: index,
    })
    created++
  }

  markRunOnce(SEED_ID)
  console.log(`[modeSeeder] Seeded ${created} mode(s)`)
  return created
}
```

- [ ] **Step 5: Lancer le test pour vérifier qu'il passe**

Run: `bun test --preload lib/__tests__/setup.ts lib/main/modes/modeSeeder.test.ts`
Expected: PASS — 8 tests

- [ ] **Step 6: Appeler le seeder au démarrage**

Dans `lib/main/store.ts`, à la fin de `initializeStore()`, après `runMigrations(store, migrations)` :

```typescript
  // 5) Sème les modes. Après les migrations : la migration des raccourcis
  //    référence les ids semés, donc les modes doivent exister d'abord.
  if (process.env.NODE_ENV !== 'test') {
    const { seedModes } = await import('./modes/modeSeeder')
    const userId = getCurrentUserId() || 'self-hosted'
    await seedModes(userId)
  }
```

> **Ordre critique** : le semis doit précéder la migration des raccourcis (tâche 1.6), qui pointe vers `voice-to-text` et `intelligent`. Comme `runMigrations` est synchrone et le semis asynchrone, la migration des raccourcis sera écrite en tâche 1.6 comme une **étape post-semis** et non comme une migration de `store.ts`.

- [ ] **Step 7: Commit**

```bash
git add lib/main/modes/modeSeeder.ts lib/main/modes/modeSeeder.test.ts lib/main/store.ts
git commit -m "feat(modes): seed the six preset modes on first launch"
```

---

### Task 1.5 : Migration des réglages globaux vers les modes

**Files:**
- Create: `lib/main/modes/modeSettingsMigration.ts`
- Test: `lib/main/modes/modeSettingsMigration.test.ts`
- Modify: `lib/main/store.ts` (appel après le semis ; élagage de `AdvancedSettings`)

**Interfaces:**
- Consumes: `ModesTable` ; `store` ; `hasRunOnce` / `markRunOnce` de `./modeSeeder`
- Produces: `migrateSettingsIntoModes(): Promise<void>` — idempotent via `appliedMigrations`, id `2026-08-14-settings-into-modes`

> **Cette migration ne doit jamais tourner deux fois.** Elle supprime `asrLanguage` du store ; un second passage lirait une valeur absente et réécrirait `language: 'auto'` sur tous les modes en écrasant leur `textModelKey`. C'est pour cette raison précise que le drapeau passe par `appliedMigrations` (voir la note « piège de persistance » en tête de lot) et non par une clé top-level.

**Ce que la migration transporte :**

| Réglage global | Destination |
|---|---|
| `advancedSettings.shortVoiceModelKey` | `modes['voice-to-text'].voiceModelKey` |
| `advancedSettings.longVoiceModelKey` | `modes['intelligent'].voiceModelKey` |
| `advancedSettings.textModelKey` | `voiceModelKey` inchangé ; copié dans `textModelKey` de tous les modes `useLlm` |
| `advancedSettings.llm.editingPrompt` | `modes['intelligent'].instructions` **si non vide** |
| `advancedSettings.llm.asrPrompt` | `asrPrompt` de tous les modes semés **si non vide** |
| `advancedSettings.llm.asrLanguage` | `language` de tous les modes semés, si c'est `fr`/`en`/`es` |

- [ ] **Step 1: Écrire le test qui échoue**

```typescript
// lib/main/modes/modeSettingsMigration.test.ts
import { describe, test, expect, mock, beforeEach } from 'bun:test'

let advanced: any = {}
let applied: string[] = []
const modes: any[] = []

const mockStoreGet = mock((key: string) => {
  if (key === 'advancedSettings') return advanced
  if (key === 'appliedMigrations') return applied
  if (key === 'userProfile') return { id: 'self-hosted' }
  return undefined
})
const mockStoreSet = mock((key: string, value: unknown) => {
  if (key === 'advancedSettings') advanced = value
  if (key === 'appliedMigrations') applied = value as string[]
})

mock.module('../store', () => ({
  default: { get: mockStoreGet, set: mockStoreSet },
  store: { get: mockStoreGet, set: mockStoreSet },
  getCurrentUserId: () => 'self-hosted',
}))

const mockUpdate = mock(async (_id: string, _patch: any) => {})
mock.module('./ModeRepository', () => ({
  ModesTable: {
    findAll: async () => modes,
    update: mockUpdate,
  },
}))

const { migrateSettingsIntoModes } = await import('./modeSettingsMigration')

const patchFor = (id: string) =>
  mockUpdate.mock.calls.find(call => call[0] === id)?.[1]

describe('migrateSettingsIntoModes', () => {
  beforeEach(() => {
    applied = []
    mockUpdate.mockClear()
    modes.length = 0
    modes.push(
      { id: 'voice-to-text', useLlm: false },
      { id: 'intelligent', useLlm: true },
      { id: 'message', useLlm: true },
      { id: 'mail', useLlm: true },
      { id: 'blank', useLlm: true },
    )
    advanced = {
      shortVoiceModelKey: 'whisper-large-v3-turbo',
      longVoiceModelKey: 'qwen3-asr-flash',
      textModelKey: 'gpt-5-6-luna',
      llm: {
        editingPrompt: 'Rewrite as a GitHub issue.',
        asrPrompt: 'Dictée technique.',
        asrLanguage: 'fr',
        transcriptionPrompt: 'dead field',
        llmTemperature: 0.1,
        noSpeechThreshold: 0.6,
      },
    }
  })

  test("Caleb's measured voice models land on the right modes", async () => {
    await migrateSettingsIntoModes()

    expect(patchFor('voice-to-text').voiceModelKey).toBe('whisper-large-v3-turbo')
    expect(patchFor('intelligent').voiceModelKey).toBe('qwen3-asr-flash')
  })

  test('the global editing prompt becomes the Intelligent mode instructions', async () => {
    await migrateSettingsIntoModes()
    expect(patchFor('intelligent').instructions).toBe('Rewrite as a GitHub issue.')
  })

  test('an empty editing prompt leaves the preset instructions alone', async () => {
    advanced.llm.editingPrompt = ''
    await migrateSettingsIntoModes()
    expect(patchFor('intelligent')?.instructions).toBeUndefined()
  })

  test('the ASR priming and language reach every mode', async () => {
    await migrateSettingsIntoModes()
    for (const id of ['voice-to-text', 'intelligent', 'message', 'mail', 'blank']) {
      expect(patchFor(id).asrPrompt).toBe('Dictée technique.')
      expect(patchFor(id).language).toBe('fr')
    }
  })

  test('an unsupported ASR language falls back to automatic', async () => {
    advanced.llm.asrLanguage = 'de'
    await migrateSettingsIntoModes()
    expect(patchFor('intelligent').language).toBe('auto')
  })

  test('the text model only reaches the modes that use the LLM', async () => {
    await migrateSettingsIntoModes()
    expect(patchFor('intelligent').textModelKey).toBe('gpt-5-6-luna')
    expect(patchFor('voice-to-text').textModelKey).toBeUndefined()
  })

  test('the dead and migrated settings are removed from the store', async () => {
    await migrateSettingsIntoModes()

    expect(advanced.shortVoiceModelKey).toBeUndefined()
    expect(advanced.longVoiceModelKey).toBeUndefined()
    expect(advanced.longDictationEnabled).toBeUndefined()
    expect(advanced.longDictationThresholdMs).toBeUndefined()
    expect(advanced.llm.editingPrompt).toBeUndefined()
    expect(advanced.llm.transcriptionPrompt).toBeUndefined()
    expect(advanced.llm.asrPrompt).toBeUndefined()
    expect(advanced.llm.asrLanguage).toBeUndefined()
    // Conservés : ils restent globaux.
    expect(advanced.llm.noSpeechThreshold).toBe(0.6)
    expect(advanced.textModelKey).toBe('gpt-5-6-luna')
  })

  test('runs once, and the flag lands where initializeStore will actually reload it', async () => {
    await migrateSettingsIntoModes()

    expect(applied).toContain('2026-08-14-settings-into-modes')

    mockUpdate.mockClear()
    await migrateSettingsIntoModes()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  test('a second run after a restart never clobbers the modes', async () => {
    // Le scénario que le drapeau existe pour empêcher : au deuxième passage,
    // asrLanguage n'existe plus, donc la migration écraserait language et
    // textModelKey sur tous les modes.
    await migrateSettingsIntoModes()
    const languageAfterFirstRun = patchFor('intelligent').language
    mockUpdate.mockClear()

    await migrateSettingsIntoModes()

    expect(mockUpdate).not.toHaveBeenCalled()
    expect(languageAfterFirstRun).toBe('fr')
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `bun test --preload lib/__tests__/setup.ts lib/main/modes/modeSettingsMigration.test.ts`
Expected: FAIL — `Cannot find module './modeSettingsMigration'`

- [ ] **Step 3: Écrire `lib/main/modes/modeSettingsMigration.ts`**

```typescript
import store from '../store'
import { STORE_KEYS } from '../../constants/store-keys'
import { ModesTable } from './ModeRepository'
import { hasRunOnce, markRunOnce } from './modeSeeder'
import type { ModeLanguageValue } from '../sqlite/models'

/**
 * Déverse dans les modes les réglages qui étaient globaux.
 *
 * Le point sensible : `shortVoiceModelKey` et `longVoiceModelKey` sont le
 * résultat d'un banc de mesure sur les vraies dictées de Caleb. Les perdre en
 * chemin le renverrait sur des défauts qu'il n'a pas choisis — d'où le
 * fléchage explicite court → « Voice to text », long → « Intelligent », qui
 * reproduit exactement son réglage.
 *
 * Strictement une fois. Elle supprime `asrLanguage` en fin de course ; un
 * second passage lirait une valeur absente et réécrirait `language: 'auto'`
 * sur tous les modes en écrasant leur `textModelKey`.
 */
const MIGRATION_ID = '2026-08-14-settings-into-modes'

const SUPPORTED_LANGUAGES: ModeLanguageValue[] = ['fr', 'en', 'es', 'auto']

export async function migrateSettingsIntoModes(): Promise<void> {
  if (hasRunOnce(MIGRATION_ID)) return

  const advanced: any = store.get(STORE_KEYS.ADVANCED_SETTINGS) || {}
  const llm: any = advanced.llm || {}
  const modes = await ModesTable.findAll(
    (store.get(STORE_KEYS.USER_PROFILE) as any)?.id || 'self-hosted',
  )

  const asrPrompt: string = (llm.asrPrompt || '').trim()
  const rawLanguage: string = (llm.asrLanguage || '').trim()
  const language: ModeLanguageValue = SUPPORTED_LANGUAGES.includes(
    rawLanguage as ModeLanguageValue,
  )
    ? (rawLanguage as ModeLanguageValue)
    : 'auto'
  const editingPrompt: string = (llm.editingPrompt || '').trim()

  const voiceModelByMode: Record<string, string | undefined> = {
    'voice-to-text': advanced.shortVoiceModelKey,
    intelligent: advanced.longVoiceModelKey,
  }

  for (const mode of modes) {
    const patch: Record<string, unknown> = { language }

    if (asrPrompt) patch.asrPrompt = asrPrompt
    if (voiceModelByMode[mode.id]) {
      patch.voiceModelKey = voiceModelByMode[mode.id]
    }
    if (mode.useLlm && advanced.textModelKey) {
      patch.textModelKey = advanced.textModelKey
    }
    if (mode.id === 'intelligent' && editingPrompt) {
      patch.instructions = editingPrompt
    }

    await ModesTable.update(mode.id, patch as any)
  }

  // Ce qui a déménagé ou qui était mort quitte les réglages : deux endroits
  // pour la même valeur est la garantie qu'ils divergeront.
  const nextLlm = { ...llm }
  delete nextLlm.editingPrompt
  delete nextLlm.transcriptionPrompt
  delete nextLlm.asrPrompt
  delete nextLlm.asrLanguage

  const next = { ...advanced, llm: nextLlm }
  delete next.shortVoiceModelKey
  delete next.longVoiceModelKey
  delete next.longDictationEnabled
  delete next.longDictationThresholdMs

  store.set(STORE_KEYS.ADVANCED_SETTINGS, next)
  markRunOnce(MIGRATION_ID)
  console.log('[modeSettingsMigration] Global settings moved into modes')
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `bun test --preload lib/__tests__/setup.ts lib/main/modes/modeSettingsMigration.test.ts`
Expected: PASS — 9 tests

- [ ] **Step 5: Brancher la migration après le semis**

Dans `lib/main/store.ts`, dans le bloc ajouté à la tâche 1.4, après `await seedModes(userId)` :

```typescript
    const { migrateSettingsIntoModes } = await import(
      './modes/modeSettingsMigration'
    )
    await migrateSettingsIntoModes()
```

- [ ] **Step 6: Élaguer l'interface `AdvancedSettings`**

Dans `lib/main/store.ts`, remplacer l'interface `AdvancedSettings` (lignes 89-105) par :

```typescript
export interface AdvancedSettings {
  llm: LlmSettings
  grammarServiceEnabled: boolean
  macosAccessibilityContextEnabled: boolean
  groqApiKey?: string
  openRouterApiKey?: string
  /**
   * Modèle texte par défaut des modes créés ensuite. Le modèle réellement
   * utilisé est celui du mode ; celui-ci ne sert qu'à préremplir.
   */
  textModelKey?: string
  // Pourquoi la dernière dictée longue n'a pas pu utiliser OpenRouter.
  openRouterFailure?: OpenRouterFailure | null
}
```

Et retirer de `defaultValues.advancedSettings` (lignes 193-199) les clés `shortVoiceModelKey`, `longVoiceModelKey`, `longDictationEnabled`, `longDictationThresholdMs`. Retirer aussi de `LlmSettings` (dans `app/store/useAdvancedSettingsStore.ts`) les champs `asrPrompt`, `asrLanguage`, `transcriptionPrompt`, `editingPrompt`.

Retirer aussi les quatre champs des défauts générés : `lib/constants/generated-defaults.ts` (`asrPrompt`, `asrLanguage`, `transcriptionPrompt`, `editingPrompt`) et `lib/main/store.ts:184-190`. Les laisser produirait des défauts que plus rien ne lit.

- [ ] **Step 7: Vérifier la compilation du main et noter les erreurs attendues**

Run: `bunx tsc --noEmit -p tsconfig.node.json`

Erreurs **attendues** à ce stade, réparées à la tâche 1.11 — ne rien corriger ici, mais vérifier que la liste correspond exactement :

| Fichier | Cause |
|---|---|
| `lib/main/itoStreamController.ts` | Lit `llm.asrPrompt`, `llm.asrLanguage`, `shortVoiceModelKey`, `longVoiceModelKey` |
| `lib/main/transcription/TranscriptAdjuster.ts` | Lit `llm.editingPrompt` |
| `lib/main/context/ContextGrabber.ts` | Signature `gatherContext(mode)` |
| `lib/clients/grpcClient.ts:166,176,543,547,548` | Lit `asrPrompt` et `transcriptionPrompt` |
| `lib/main/syncService.ts:306-325` | Lit `asrPrompt`, `asrLanguage`, `transcriptionPrompt` |

> Les deux derniers sont morts en mode local — le client gRPC est désactivé — mais ils compilent. Les traiter en même temps que les autres à la tâche 1.11 : supprimer les lignes correspondantes plutôt que de les repointer, puisque le serveur ne reçoit plus ces réglages.

- [ ] **Step 8: Commit**

```bash
git add lib/main/modes/modeSettingsMigration.ts lib/main/modes/modeSettingsMigration.test.ts lib/main/store.ts app/store/useAdvancedSettingsStore.ts
git commit -m "refactor(modes): move global voice/prompt settings into modes"
```

---

### Task 1.6 : Migration des raccourcis et retrait de `ItoMode`

**Files:**
- Create: `lib/main/modes/shortcutMigration.ts`
- Test: `lib/main/modes/shortcutMigration.test.ts`
- Modify: `lib/main/store.ts:24-28` (type `KeyboardShortcutConfig`)
- Modify: `lib/constants/keyboard-defaults.ts`

**Interfaces:**
- Produces:
  - `migrateShortcutsToModeIds(): void` — idempotent
  - `KeyboardShortcutConfig` devient `{ id: string; keys: KeyName[]; modeId: string }`
  - `LEGACY_MODE_IDS: Record<number, string>` = `{ 0: 'voice-to-text', 1: 'intelligent' }`

- [ ] **Step 1: Écrire le test qui échoue**

```typescript
// lib/main/modes/shortcutMigration.test.ts
import { describe, test, expect, mock, beforeEach } from 'bun:test'

let settings: any = {}
let applied: string[] = []

const mockStoreGet = mock((key: string) => {
  if (key === 'settings') return settings
  if (key === 'appliedMigrations') return applied
  return undefined
})
const mockStoreSet = mock((key: string, value: unknown) => {
  if (key === 'settings') settings = value
  if (key === 'appliedMigrations') applied = value as string[]
})

mock.module('../store', () => ({
  default: { get: mockStoreGet, set: mockStoreSet },
  store: { get: mockStoreGet, set: mockStoreSet },
}))

const { migrateShortcutsToModeIds } = await import('./shortcutMigration')

describe('migrateShortcutsToModeIds', () => {
  beforeEach(() => {
    applied = []
    mockStoreSet.mockClear()
    // Le JSON exact du store de Caleb au 2026-08-14.
    settings = {
      keyboardShortcuts: [
        {
          id: 'ed826a4b-532c-49d5-bb3b-c076ba6ffc69',
          keys: ['control-left', 'command-left'],
          mode: 0,
        },
        {
          id: '66da8422-884e-4549-9d45-a0d0b7a0909a',
          keys: ['option-left', 'control-left'],
          mode: 1,
        },
      ],
    }
  })

  test('maps the two legacy modes onto the seeded mode ids', () => {
    migrateShortcutsToModeIds()

    expect(settings.keyboardShortcuts).toEqual([
      {
        id: 'ed826a4b-532c-49d5-bb3b-c076ba6ffc69',
        keys: ['control-left', 'command-left'],
        modeId: 'voice-to-text',
      },
      {
        id: '66da8422-884e-4549-9d45-a0d0b7a0909a',
        keys: ['option-left', 'control-left'],
        modeId: 'intelligent',
      },
    ])
  })

  test('keys and shortcut ids survive untouched — this is the highest-risk migration', () => {
    const before = JSON.parse(JSON.stringify(settings.keyboardShortcuts))
    migrateShortcutsToModeIds()

    settings.keyboardShortcuts.forEach((shortcut: any, index: number) => {
      expect(shortcut.id).toBe(before[index].id)
      expect(shortcut.keys).toEqual(before[index].keys)
    })
  })

  test('an unknown legacy mode falls back to voice-to-text rather than losing the binding', () => {
    settings.keyboardShortcuts = [{ id: 'x', keys: ['fn'], mode: 7 }]
    migrateShortcutsToModeIds()
    expect(settings.keyboardShortcuts[0].modeId).toBe('voice-to-text')
  })

  test('runs once', () => {
    migrateShortcutsToModeIds()
    mockStoreSet.mockClear()
    migrateShortcutsToModeIds()
    expect(mockStoreSet).not.toHaveBeenCalled()
  })

  test('a store with no shortcuts does not throw', () => {
    settings = {}
    expect(() => migrateShortcutsToModeIds()).not.toThrow()
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `bun test --preload lib/__tests__/setup.ts lib/main/modes/shortcutMigration.test.ts`
Expected: FAIL — `Cannot find module './shortcutMigration'`

- [ ] **Step 3: Écrire `lib/main/modes/shortcutMigration.ts`**

```typescript
import store from '../store'
import { STORE_KEYS } from '../../constants/store-keys'
import { hasRunOnce, markRunOnce } from './modeSeeder'

/**
 * Les raccourcis pointaient vers une valeur de l'enum `ItoMode` ; ils pointent
 * désormais vers l'id d'un mode.
 *
 * C'est la migration la plus risquée du chantier : si elle se trompe, le
 * symptôme est « mon raccourci ne fait plus rien », le pire à diagnostiquer.
 * D'où le repli sur `voice-to-text` plutôt qu'un abandon du raccourci quand la
 * valeur d'origine est inconnue — un raccourci qui déclenche le mauvais mode
 * se voit et se corrige, un raccourci muet ressemble à une app cassée.
 */
const MIGRATION_ID = '2026-08-14-shortcuts-to-mode-ids'

export const LEGACY_MODE_IDS: Record<number, string> = {
  0: 'voice-to-text',
  1: 'intelligent',
}

export function migrateShortcutsToModeIds(): void {
  if (hasRunOnce(MIGRATION_ID)) return

  const settings: any = store.get(STORE_KEYS.SETTINGS) || {}
  const shortcuts: any[] = Array.isArray(settings.keyboardShortcuts)
    ? settings.keyboardShortcuts
    : []

  const migrated = shortcuts.map(shortcut => {
    const { mode, ...rest } = shortcut
    return {
      ...rest,
      modeId:
        shortcut.modeId ?? LEGACY_MODE_IDS[mode] ?? LEGACY_MODE_IDS[0],
    }
  })

  store.set(STORE_KEYS.SETTINGS, {
    ...settings,
    keyboardShortcuts: migrated,
  })
  markRunOnce(MIGRATION_ID)
  console.log(
    `[shortcutMigration] Rebound ${migrated.length} shortcut(s) to mode ids`,
  )
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `bun test --preload lib/__tests__/setup.ts lib/main/modes/shortcutMigration.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 5: Mettre à jour le type et les défauts**

Dans `lib/main/store.ts`, remplacer :

```typescript
export interface KeyboardShortcutConfig {
  id: string
  keys: KeyName[]
  mode: ItoMode
}
```

par :

```typescript
export interface KeyboardShortcutConfig {
  id: string
  keys: KeyName[]
  /** Id d'une ligne de la table `modes`. */
  modeId: string
}
```

Dans `defaultValues.settings.keyboardShortcuts` (lignes 156-171), remplacer `mode: ItoMode.TRANSCRIBE` par `modeId: 'voice-to-text'` et `mode: ItoMode.EDIT` par `modeId: 'intelligent'`, et indexer les défauts par id de mode.

Dans `lib/constants/keyboard-defaults.ts`, remplacer les clés `ItoMode` par les ids de modes, **en gardant la forme fonction** (elle est appelée avec une plateforme explicite depuis l'onboarding) :

```typescript
const MAC_DEFAULTS: Record<string, string[]> = {
  'voice-to-text': ['fn'],
  intelligent: ['control-left', 'fn'],
}

const WIN_DEFAULTS: Record<string, string[]> = {
  'voice-to-text': ['control-left', 'command-left'],
  intelligent: ['option-left', 'control-left'],
}

export function getModeShortcutDefaults(
  platform: string = process.platform,
): Record<string, string[]> {
  return platform === 'darwin' ? MAC_DEFAULTS : WIN_DEFAULTS
}

export const MODE_SHORTCUT_DEFAULTS = getModeShortcutDefaults()
```

**Les anciens exports ont cinq appelants, pas un.** Vérifié dans le code :

```
ITO_MODE_SHORTCUT_DEFAULTS        lib/main/store.ts:13,164,171
                                  app/store/useSettingsStore.ts:14,78,83
getItoModeShortcutDefaults        app/components/welcome/contents/KeyboardTestContext.tsx:5,17
```

Les trois doivent être repointés dans la même étape, sinon ni le store renderer ni l'onboarding ne compilent.

- [ ] **Step 6: Brancher la migration après celle des réglages**

Dans `lib/main/store.ts`, après `await migrateSettingsIntoModes()` :

```typescript
    const { migrateShortcutsToModeIds } = await import(
      './modes/shortcutMigration'
    )
    migrateShortcutsToModeIds()
```

- [ ] **Step 7: Commit**

```bash
git add lib/main/modes/shortcutMigration.ts lib/main/modes/shortcutMigration.test.ts lib/main/store.ts lib/constants/keyboard-defaults.ts
git commit -m "refactor(modes): shortcuts point at mode ids instead of the ItoMode enum"
```

---

### Task 1.7 : Mode actif

**Files:**
- Create: `lib/main/modes/activeMode.ts`
- Test: `lib/main/modes/activeMode.test.ts`

**Interfaces:**
- Consumes: `ModesTable` ; `store`
- Produces:
  - `getActiveModeId(): string | undefined`
  - `setActiveModeId(id: string): void`
  - `resolveActiveMode(): Promise<Mode>` — jamais `undefined` : replie sur le premier mode
  - `resolveMode(modeId: string | undefined): Promise<Mode>` — idem
  - `cycleActiveMode(direction?: 1 | -1): Promise<Mode>`

- [ ] **Step 1: Écrire le test qui échoue**

```typescript
// lib/main/modes/activeMode.test.ts
import { describe, test, expect, mock, beforeEach } from 'bun:test'

let settings: any = {}
const modes: any[] = []

mock.module('../store', () => ({
  default: {
    get: (key: string) => (key === 'settings' ? settings : undefined),
    set: (key: string, value: unknown) => {
      if (key === 'settings') settings = value
    },
  },
  store: {
    get: (key: string) => (key === 'settings' ? settings : undefined),
    set: (key: string, value: unknown) => {
      if (key === 'settings') settings = value
    },
  },
  getCurrentUserId: () => 'self-hosted',
}))

mock.module('./ModeRepository', () => ({
  ModesTable: {
    findAll: async () => modes,
    findById: async (id: string) => modes.find(m => m.id === id),
  },
}))

const {
  getActiveModeId,
  setActiveModeId,
  resolveActiveMode,
  resolveMode,
  cycleActiveMode,
} = await import('./activeMode')

describe('activeMode', () => {
  beforeEach(() => {
    settings = {}
    modes.length = 0
    modes.push(
      { id: 'voice-to-text', name: 'Voice to text', sortOrder: 0 },
      { id: 'intelligent', name: 'Intelligent', sortOrder: 1 },
      { id: 'meeting', name: 'Meeting', sortOrder: 2 },
    )
  })

  test('with nothing stored, the first mode is active', async () => {
    expect(getActiveModeId()).toBeUndefined()
    expect((await resolveActiveMode()).id).toBe('voice-to-text')
  })

  test('the active mode round-trips through the store', async () => {
    setActiveModeId('meeting')
    expect(getActiveModeId()).toBe('meeting')
    expect((await resolveActiveMode()).id).toBe('meeting')
  })

  test('a stored id that no longer exists falls back to the first mode', async () => {
    setActiveModeId('deleted-mode')
    expect((await resolveActiveMode()).id).toBe('voice-to-text')
  })

  test('resolveMode falls back rather than returning undefined — a dictation must never be lost to a missing mode', async () => {
    expect((await resolveMode('meeting')).id).toBe('meeting')
    expect((await resolveMode('nope')).id).toBe('voice-to-text')
    expect((await resolveMode(undefined)).id).toBe('voice-to-text')
  })

  test('cycling walks the list and wraps around', async () => {
    setActiveModeId('voice-to-text')

    expect((await cycleActiveMode()).id).toBe('intelligent')
    expect((await cycleActiveMode()).id).toBe('meeting')
    expect((await cycleActiveMode()).id).toBe('voice-to-text')
  })

  test('cycling backwards wraps the other way', async () => {
    setActiveModeId('voice-to-text')
    expect((await cycleActiveMode(-1)).id).toBe('meeting')
  })

  test('cycling with a single mode is a no-op, not a crash', async () => {
    modes.length = 1
    setActiveModeId('voice-to-text')
    expect((await cycleActiveMode()).id).toBe('voice-to-text')
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `bun test --preload lib/__tests__/setup.ts lib/main/modes/activeMode.test.ts`
Expected: FAIL — `Cannot find module './activeMode'`

- [ ] **Step 3: Écrire `lib/main/modes/activeMode.ts`**

```typescript
import store, { getCurrentUserId } from '../store'
import { STORE_KEYS } from '../../constants/store-keys'
import { ModesTable } from './ModeRepository'
import type { Mode } from '../sqlite/models'

/**
 * Le mode actif : celui qu'une dictée utilise quand aucun raccourci dédié ne
 * l'a court-circuitée.
 *
 * Toutes les résolutions replient sur le premier mode plutôt que de rendre
 * `undefined`. Une dictée perdue parce que le mode sélectionné a été supprimé
 * serait un échec bien pire que d'être transcrite par le mauvais mode.
 */

const userId = () => getCurrentUserId() || 'self-hosted'

export function getActiveModeId(): string | undefined {
  return (store.get(STORE_KEYS.SETTINGS) as any)?.activeModeId
}

export function setActiveModeId(id: string): void {
  const settings: any = store.get(STORE_KEYS.SETTINGS) || {}
  store.set(STORE_KEYS.SETTINGS, { ...settings, activeModeId: id })
}

export async function resolveMode(modeId: string | undefined): Promise<Mode> {
  if (modeId) {
    const mode = await ModesTable.findById(modeId)
    if (mode) return mode
    console.warn(`[activeMode] Mode "${modeId}" is gone, falling back`)
  }

  const modes = await ModesTable.findAll(userId())
  if (modes.length === 0) {
    throw new Error('No mode available — the seeder did not run')
  }
  return modes[0]
}

export function resolveActiveMode(): Promise<Mode> {
  return resolveMode(getActiveModeId())
}

export async function cycleActiveMode(direction: 1 | -1 = 1): Promise<Mode> {
  const modes = await ModesTable.findAll(userId())
  if (modes.length === 0) {
    throw new Error('No mode available — the seeder did not run')
  }

  const current = getActiveModeId()
  const index = modes.findIndex(mode => mode.id === current)
  const next = modes[(index + direction + modes.length) % modes.length]

  setActiveModeId(next.id)
  console.log(`[activeMode] Active mode is now "${next.name}"`)
  return next
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `bun test --preload lib/__tests__/setup.ts lib/main/modes/activeMode.test.ts`
Expected: PASS — 7 tests

- [ ] **Step 5: Commit**

```bash
git add lib/main/modes/activeMode.ts lib/main/modes/activeMode.test.ts
git commit -m "feat(modes): active mode resolution and cycling"
```

---

### Task 1.8 : IPC, preload et store renderer

**Files:**
- Modify: `lib/window/ipcEvents.ts` (ajouter le bloc `modes:*` près de `dictionary:*`, ligne ~785)
- Modify: `lib/preload/api.ts:239` (après `getOpenRouterFailure`)
- Modify: `app/index.d.ts` (interface `IpcApi`)
- Create: `app/store/useModesStore.ts`
- Test: `lib/window/modesIpc.test.ts`

**Interfaces:**
- Produces (canaux IPC) :
  - `modes:get-all` → `Mode[]`
  - `modes:create` `(preset: string, name: string)` → `Mode`
  - `modes:update` `(id: string, patch: Partial<Mode>)` → `void`
  - `modes:delete` `(id: string)` → `void`
  - `modes:duplicate` `(id: string)` → `Mode`
  - `modes:set-active` `(id: string)` → `void`
  - `modes:get-active` → `string | undefined`
  - `modes:examples:get` `(modeId: string)` → `ModeExample[]`
  - `modes:examples:add` `(modeId, spokenInput, aiOutput)` → `ModeExample`
  - `modes:examples:update` `(id, spokenInput, aiOutput)` → `void`
  - `modes:examples:delete` `(id)` → `void`
- Produces (renderer) : `useModesStore` avec `modes`, `activeModeId`, `load()`, `create(preset, name)`, `update(id, patch)`, `remove(id)`, `duplicate(id)`, `setActive(id)`

- [ ] **Step 1: Écrire le test qui échoue**

```typescript
// lib/window/modesIpc.test.ts
import { describe, test, expect, mock, beforeEach } from 'bun:test'

const handlers = new Map<string, (...args: any[]) => any>()
const mockHandle = mock((channel: string, handler: any) => {
  handlers.set(channel, handler)
})

mock.module('electron', () => ({
  ipcMain: { handle: mockHandle, on: mock(() => {}) },
  BrowserWindow: { getAllWindows: () => [] },
  shell: {},
  app: { getPath: () => '/tmp' },
  dialog: {},
}))

const created: any[] = []
mock.module('../main/modes/ModeRepository', () => ({
  ModesTable: {
    findAll: async () => [{ id: 'intelligent', name: 'Intelligent', sortOrder: 1 }],
    findById: async (id: string) =>
      id === 'intelligent' ? { id, name: 'Intelligent', sortOrder: 1 } : undefined,
    insert: async (mode: any) => {
      created.push(mode)
      return mode
    },
    update: async () => {},
    softDelete: async () => {},
    count: async () => 6,
  },
  ModeExamplesTable: {
    findByMode: async () => [],
    insert: async (e: any) => e,
    update: async () => {},
    softDelete: async () => {},
  },
}))

const { registerModeIpc } = await import('./modesIpc')

describe('modes IPC', () => {
  beforeEach(() => {
    handlers.clear()
    created.length = 0
    registerModeIpc()
  })

  test('registers every mode channel', () => {
    for (const channel of [
      'modes:get-all',
      'modes:create',
      'modes:update',
      'modes:delete',
      'modes:duplicate',
      'modes:set-active',
      'modes:get-active',
      'modes:examples:get',
      'modes:examples:add',
      'modes:examples:update',
      'modes:examples:delete',
    ]) {
      expect(handlers.has(channel)).toBe(true)
    }
  })

  test('creating from a preset copies its fields and gives a fresh uuid', async () => {
    await handlers.get('modes:create')!({}, 'meeting', 'My meeting')

    expect(created).toHaveLength(1)
    expect(created[0].id).toBeUndefined()
    expect(created[0].name).toBe('My meeting')
    expect(created[0].preset).toBe('meeting')
    expect(created[0].audioSource).toBe('both')
  })

  test('creating from an unknown preset falls back to blank', async () => {
    await handlers.get('modes:create')!({}, 'nope', 'X')
    expect(created[0].preset).toBe('blank')
  })

  test('duplicating copies everything but the id and the name', async () => {
    await handlers.get('modes:duplicate')!({}, 'intelligent')

    expect(created[0].id).toBeUndefined()
    expect(created[0].name).toBe('Intelligent (copy)')
  })

  test('deleting the last mode is refused — the pipeline needs one', async () => {
    const result = await handlers.get('modes:delete')!({}, 'intelligent')
    expect(result).toEqual({ ok: true })
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `bun test --preload lib/__tests__/setup.ts lib/window/modesIpc.test.ts`
Expected: FAIL — `Cannot find module './modesIpc'`

- [ ] **Step 3: Écrire `lib/window/modesIpc.ts`**

```typescript
import { ipcMain } from 'electron'
import { ModesTable, ModeExamplesTable } from '../main/modes/ModeRepository'
import {
  getActiveModeId,
  setActiveModeId,
  cycleActiveMode,
} from '../main/modes/activeMode'
import { findPreset, MODE_PRESETS } from '../constants/modePresets'
import { getCurrentUserId } from '../main/store'
import type { Mode } from '../main/sqlite/models'

/**
 * Canaux IPC des modes.
 *
 * Sortis de `ipcEvents.ts`, qui frôle les mille lignes : les modes ont onze
 * canaux à eux seuls et leur logique de création mérite d'être lisible.
 */

const userId = () => getCurrentUserId() || 'self-hosted'

const BLANK = MODE_PRESETS.find(preset => preset.key === 'blank')!

/** Les champs d'un mode qui viennent d'un preset, sans l'identité. */
function fieldsFromPreset(presetKey: string) {
  const preset = findPreset(presetKey) ?? BLANK
  return {
    preset: preset.key,
    icon: preset.icon,
    instructions: preset.instructions,
    language: preset.language,
    voiceModelKey: preset.voiceModelKey,
    textModelKey: preset.textModelKey,
    useLlm: preset.useLlm,
    contextApplication: preset.contextApplication,
    contextClipboard: preset.contextClipboard,
    contextSelection: preset.contextSelection,
    audioSource: preset.audioSource,
    playbackWhenRecording: preset.playbackWhenRecording,
    autoPaste: preset.autoPaste,
    autocapitalize: preset.autocapitalize,
    identifySpeakers: preset.identifySpeakers,
    asrPrompt: preset.asrPrompt,
  }
}

export function registerModeIpc() {
  ipcMain.handle('modes:get-all', () => ModesTable.findAll(userId()))

  ipcMain.handle('modes:create', async (_e, presetKey: string, name: string) => {
    const modes = await ModesTable.findAll(userId())
    return ModesTable.insert({
      userId: userId(),
      name: name.trim() || findPreset(presetKey)?.label || 'New mode',
      sortOrder: modes.length,
      ...fieldsFromPreset(presetKey),
    } as any)
  })

  ipcMain.handle('modes:update', (_e, id: string, patch: Partial<Mode>) =>
    ModesTable.update(id, patch),
  )

  ipcMain.handle('modes:delete', async (_e, id: string) => {
    // Le pipeline résout toujours un mode : n'en laisser aucun le ferait
    // échouer sur chaque dictée.
    if ((await ModesTable.count(userId())) <= 1) {
      return { ok: false, error: 'The last mode cannot be deleted' }
    }
    await ModesTable.softDelete(id)
    if (getActiveModeId() === id) {
      const remaining = await ModesTable.findAll(userId())
      setActiveModeId(remaining[0].id)
    }
    return { ok: true }
  })

  ipcMain.handle('modes:duplicate', async (_e, id: string) => {
    const source = await ModesTable.findById(id)
    if (!source) return null

    const modes = await ModesTable.findAll(userId())
    const copy = await ModesTable.insert({
      userId: userId(),
      name: `${source.name} (copy)`,
      sortOrder: modes.length,
      preset: source.preset,
      icon: source.icon,
      instructions: source.instructions,
      language: source.language,
      voiceModelKey: source.voiceModelKey,
      textModelKey: source.textModelKey,
      useLlm: source.useLlm,
      contextApplication: source.contextApplication,
      contextClipboard: source.contextClipboard,
      contextSelection: source.contextSelection,
      audioSource: source.audioSource,
      playbackWhenRecording: source.playbackWhenRecording,
      autoPaste: source.autoPaste,
      autocapitalize: source.autocapitalize,
      identifySpeakers: source.identifySpeakers,
      asrPrompt: source.asrPrompt,
    } as any)

    for (const example of await ModeExamplesTable.findByMode(id)) {
      await ModeExamplesTable.insert({
        modeId: copy.id,
        spokenInput: example.spokenInput,
        aiOutput: example.aiOutput,
        sortOrder: example.sortOrder,
      })
    }

    return copy
  })

  ipcMain.handle('modes:set-active', (_e, id: string) => setActiveModeId(id))
  ipcMain.handle('modes:get-active', () => getActiveModeId())
  ipcMain.handle('modes:cycle-active', (_e, direction: 1 | -1 = 1) =>
    cycleActiveMode(direction),
  )

  ipcMain.handle('modes:examples:get', (_e, modeId: string) =>
    ModeExamplesTable.findByMode(modeId),
  )
  ipcMain.handle(
    'modes:examples:add',
    async (_e, modeId: string, spokenInput: string, aiOutput: string) => {
      const existing = await ModeExamplesTable.findByMode(modeId)
      return ModeExamplesTable.insert({
        modeId,
        spokenInput,
        aiOutput,
        sortOrder: existing.length,
      })
    },
  )
  ipcMain.handle(
    'modes:examples:update',
    (_e, id: string, spokenInput: string, aiOutput: string) =>
      ModeExamplesTable.update(id, spokenInput, aiOutput),
  )
  ipcMain.handle('modes:examples:delete', (_e, id: string) =>
    ModeExamplesTable.softDelete(id),
  )
}
```

- [ ] **Step 4: Appeler `registerModeIpc()` depuis `registerIPC()`**

Dans `lib/window/ipcEvents.ts`, ajouter l'import en tête et l'appel à la fin de `registerIPC()` :

```typescript
import { registerModeIpc } from './modesIpc'
// …
export function registerIPC() {
  registerModeIpc()
  // … le reste, inchangé
```

- [ ] **Step 5: Lancer le test pour vérifier qu'il passe**

Run: `bun test --preload lib/__tests__/setup.ts lib/window/modesIpc.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 6: Exposer les canaux dans le preload**

Dans `lib/preload/api.ts`, après `getOpenRouterFailure` :

```typescript
  modes: {
    getAll: () => ipcRenderer.invoke('modes:get-all'),
    create: (preset: string, name: string) =>
      ipcRenderer.invoke('modes:create', preset, name),
    update: (id: string, patch: Record<string, unknown>) =>
      ipcRenderer.invoke('modes:update', id, patch),
    delete: (id: string) => ipcRenderer.invoke('modes:delete', id),
    duplicate: (id: string) => ipcRenderer.invoke('modes:duplicate', id),
    setActive: (id: string) => ipcRenderer.invoke('modes:set-active', id),
    getActive: () => ipcRenderer.invoke('modes:get-active'),
    examples: {
      get: (modeId: string) => ipcRenderer.invoke('modes:examples:get', modeId),
      add: (modeId: string, spokenInput: string, aiOutput: string) =>
        ipcRenderer.invoke('modes:examples:add', modeId, spokenInput, aiOutput),
      update: (id: string, spokenInput: string, aiOutput: string) =>
        ipcRenderer.invoke('modes:examples:update', id, spokenInput, aiOutput),
      delete: (id: string) => ipcRenderer.invoke('modes:examples:delete', id),
    },
  },
```

- [ ] **Step 7: Déclarer dans `app/index.d.ts`**

Dans `interface IpcApi`, ajouter :

```typescript
  modes: {
    getAll: () => Promise<ModeDto[]>
    create: (preset: string, name: string) => Promise<ModeDto>
    update: (id: string, patch: Partial<ModeDto>) => Promise<void>
    delete: (id: string) => Promise<{ ok: boolean; error?: string }>
    duplicate: (id: string) => Promise<ModeDto | null>
    setActive: (id: string) => Promise<void>
    getActive: () => Promise<string | undefined>
    examples: {
      get: (modeId: string) => Promise<ModeExampleDto[]>
      add: (
        modeId: string,
        spokenInput: string,
        aiOutput: string,
      ) => Promise<ModeExampleDto>
      update: (
        id: string,
        spokenInput: string,
        aiOutput: string,
      ) => Promise<void>
      delete: (id: string) => Promise<void>
    }
  }
```

et, à la fin du fichier :

```typescript
export type { Mode as ModeDto, ModeExample as ModeExampleDto } from '../lib/main/sqlite/models'
```

- [ ] **Step 8: Écrire `app/store/useModesStore.ts`**

```typescript
import { create } from 'zustand'
import type { ModeDto } from '../index'

interface ModesStore {
  modes: ModeDto[]
  activeModeId: string | undefined
  loaded: boolean
  load: () => Promise<void>
  create: (preset: string, name: string) => Promise<ModeDto>
  update: (id: string, patch: Partial<ModeDto>) => Promise<void>
  remove: (id: string) => Promise<{ ok: boolean; error?: string }>
  duplicate: (id: string) => Promise<void>
  setActive: (id: string) => Promise<void>
}

export const useModesStore = create<ModesStore>((set, get) => ({
  modes: [],
  activeModeId: undefined,
  loaded: false,

  load: async () => {
    const [modes, activeModeId] = await Promise.all([
      window.api.modes.getAll(),
      window.api.modes.getActive(),
    ])
    set({ modes, activeModeId: activeModeId ?? modes[0]?.id, loaded: true })
  },

  create: async (preset, name) => {
    const mode = await window.api.modes.create(preset, name)
    set(state => ({ modes: [...state.modes, mode] }))
    return mode
  },

  // Optimiste : l'éditeur écrit à chaque frappe, attendre le disque ferait
  // sautiller le curseur.
  update: async (id, patch) => {
    set(state => ({
      modes: state.modes.map(mode =>
        mode.id === id ? { ...mode, ...patch } : mode,
      ),
    }))
    await window.api.modes.update(id, patch)
  },

  remove: async id => {
    const result = await window.api.modes.delete(id)
    if (result.ok) await get().load()
    return result
  },

  duplicate: async id => {
    await window.api.modes.duplicate(id)
    await get().load()
  },

  setActive: async id => {
    set({ activeModeId: id })
    await window.api.modes.setActive(id)
  },
}))
```

- [ ] **Step 9: Vérifier les types**

Run: `bunx tsc --noEmit -p tsconfig.web.json 2>&1 | grep -c "error TS"`
Expected: `136` ou moins (les erreurs préexistantes, pas une de plus)

- [ ] **Step 10: Commit**

```bash
git add lib/window/modesIpc.ts lib/window/modesIpc.test.ts lib/window/ipcEvents.ts lib/preload/api.ts app/index.d.ts app/store/useModesStore.ts
git commit -m "feat(modes): IPC surface and renderer store"
```

---

### Task 1.9 : Page Modes et entrées de sidebar

**Files:**
- Create: `app/components/home/contents/ModesContent.tsx`
- Create: `app/components/home/contents/modes/ModeRow.tsx`
- Create: `app/components/home/contents/modes/modeIcons.tsx`
- Modify: `app/components/home/HomeShell.tsx:19-31`
- Modify: `app/components/home/HomeKit.tsx:135-148`
- Modify: `app/store/useMainStore.ts:4`
- Modify: `app/components/home/contents/SettingsContent.tsx` (retirer l'onglet Models)

**Interfaces:**
- Consumes: `useModesStore` ; `MODE_PRESETS`
- Produces: `MODE_ICONS: Record<string, ComponentType<{ className?: string }>>`

- [ ] **Step 1: Écrire `app/components/home/contents/modes/modeIcons.tsx`**

```tsx
import {
  Microphone,
  Sparkles,
  UsersGroup,
  MessageDots,
  Envelope,
  SquareDashed,
} from '@mynaui/icons-react'
import type { ComponentType } from 'react'

/**
 * Les icônes que `modes.icon` peut nommer.
 *
 * La colonne stocke un nom, pas un composant : une icône inconnue (mode créé
 * par une version future, ou renommage côté paquet) tombe sur `SquareDashed`
 * plutôt que de faire planter la liste.
 */
export const MODE_ICONS: Record<
  string,
  ComponentType<{ className?: string }>
> = {
  Microphone,
  Sparkles,
  UsersGroup,
  MessageDots,
  Envelope,
  SquareDashed,
}

export function modeIcon(name: string) {
  return MODE_ICONS[name] ?? SquareDashed
}
```

- [ ] **Step 2: Écrire `app/components/home/contents/modes/ModeRow.tsx`**

```tsx
import { modeIcon } from './modeIcons'
import { cn } from '@/lib/utils'
import type { ModeDto } from '@/app/index'

/**
 * Une ligne de la liste des modes.
 *
 * La pastille verte du mode actif est le seul aplat de couleur autorisé par la
 * charte, et seulement à 6 px — d'où `size-1.5` et jamais de fond teinté.
 */
export default function ModeRow({
  mode,
  isActive,
  shortcut,
  onOpen,
  onActivate,
}: {
  mode: ModeDto
  isActive: boolean
  /** Combinaison affichable, ou null si le mode n'a pas de raccourci dédié. */
  shortcut: string | null
  onOpen: () => void
  onActivate: () => void
}) {
  const Icon = modeIcon(mode.icon)

  return (
    <div
      className={cn(
        'group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors duration-150',
        'hover:bg-secondary/40',
      )}
    >
      <button
        type="button"
        onClick={onActivate}
        title={isActive ? 'Active mode' : 'Make this the active mode'}
        className="flex size-4 shrink-0 items-center justify-center"
      >
        {isActive ? (
          <span className="size-1.5 rounded-full bg-[var(--positive)]" />
        ) : (
          <span className="size-1.5 rounded-full border border-border-strong" />
        )}
      </button>

      <Icon className="size-4 shrink-0 text-[var(--subtle-foreground)]" />

      <button
        type="button"
        onClick={onOpen}
        className="min-w-0 flex-1 text-left"
      >
        <span className="block truncate text-xs font-medium text-foreground">
          {mode.name}
        </span>
        <span className="block truncate text-[11px] leading-snug text-[var(--subtle-foreground)]">
          {mode.useLlm ? mode.preset : 'Raw transcript'}
          {mode.audioSource !== 'microphone' && ' · system audio'}
        </span>
      </button>

      {shortcut && (
        <span className="shrink-0 rounded border border-border px-1.5 py-px text-[10px] tabular-nums text-[var(--subtle-foreground)]">
          {shortcut}
        </span>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Écrire `app/components/home/contents/ModesContent.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { useModesStore } from '@/app/store/useModesStore'
import { useSettingsStore } from '@/app/store/useSettingsStore'
import { usePlatform } from '@/app/hooks/usePlatform'
import { getKeyDisplay } from '@/app/utils/keyboard'
import { MODE_PRESETS } from '@/lib/constants/modePresets'
import { Button } from '@/app/components/ui/button'
import { SettingsGroup } from '@/app/components/ui/settings'
import ModeRow from './modes/ModeRow'
import ModeEditor from './modes/ModeEditor'
import { modeIcon } from './modes/modeIcons'
import type { KeyName } from '@/lib/types/keyboard'

export default function ModesContent() {
  const { modes, activeModeId, loaded, load, create, setActive } =
    useModesStore()
  const { keyboardShortcuts } = useSettingsStore()
  const platform = usePlatform()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  const shortcutFor = (modeId: string): string | null => {
    const shortcut = keyboardShortcuts.find(s => s.modeId === modeId)
    if (!shortcut?.keys.length) return null
    return shortcut.keys
      .map(key =>
        getKeyDisplay(key as KeyName, platform, { showDirectionalText: false }),
      )
      .join(' ')
  }

  if (editingId) {
    return (
      <ModeEditor modeId={editingId} onBack={() => setEditingId(null)} />
    )
  }

  return (
    <div className="px-1.5">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="font-heading text-xs font-semibold tracking-tight text-foreground">
            Modes
          </h2>
          <p className="mt-0.5 text-[11px] leading-snug text-[var(--subtle-foreground)]">
            A mode decides what a dictation becomes. The active one is used
            unless a dedicated shortcut says otherwise.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreating(true)}>
          Create mode
        </Button>
      </div>

      {creating && (
        <SettingsGroup title="Pick a preset">
          <div className="space-y-1 py-1">
            {MODE_PRESETS.map(preset => {
              const Icon = modeIcon(preset.icon)
              return (
                <button
                  key={preset.key}
                  type="button"
                  onClick={async () => {
                    const mode = await create(preset.key, preset.label)
                    setCreating(false)
                    setEditingId(mode.id)
                  }}
                  className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors duration-150 hover:bg-secondary/40"
                >
                  <Icon className="mt-px size-4 shrink-0 text-[var(--subtle-foreground)]" />
                  <span className="min-w-0">
                    <span className="block text-xs font-medium text-foreground">
                      {preset.label}
                    </span>
                    <span className="block text-[11px] leading-snug text-[var(--subtle-foreground)]">
                      {preset.description}
                    </span>
                  </span>
                </button>
              )
            })}
            <Button
              variant="outline"
              size="sm"
              className="mt-1"
              onClick={() => setCreating(false)}
            >
              Cancel
            </Button>
          </div>
        </SettingsGroup>
      )}

      <div className="space-y-0.5">
        {modes.map(mode => (
          <ModeRow
            key={mode.id}
            mode={mode}
            isActive={mode.id === activeModeId}
            shortcut={shortcutFor(mode.id)}
            onOpen={() => setEditingId(mode.id)}
            onActivate={() => void setActive(mode.id)}
          />
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Ajouter les deux entrées de sidebar**

Dans `app/components/home/HomeShell.tsx`, remplacer les lignes 19-31 :

```tsx
type PageKey =
  | 'home'
  | 'modes'
  | 'models'
  | 'dictionary'
  | 'notes'
  | 'settings'
  | 'about'

const NAV: {
  key: PageKey
  label: string
  icon: React.ComponentType<{ className?: string }>
}[] = [
  { key: 'home', label: 'Home', icon: Home },
  { key: 'modes', label: 'Modes', icon: Sparkles },
  { key: 'models', label: 'Models', icon: Cpu },
  { key: 'dictionary', label: 'Dictionary', icon: BookOpen },
  { key: 'notes', label: 'Notes', icon: FileText },
  { key: 'settings', label: 'Settings', icon: CogFour },
  { key: 'about', label: 'About', icon: InfoCircle },
]
```

et ajouter `Sparkles` et `Cpu` à l'import de `@mynaui/icons-react` en ligne 1.

> Vérifier que `Cpu` existe : `node -e "console.log(Object.keys(require('./node_modules/@mynaui/icons-react')).filter(n=>/^Cpu/.test(n)))"`. S'il n'existe pas, utiliser `Chip` ou `Layers`.

Dans le même fichier, corriger la lecture du raccourci d'affichage (lignes 56-57) :

```tsx
  const keys: string[] = (
    useSettingsStore
      .getState()
      .keyboardShortcuts.find(s => s.modeId === 'voice-to-text')?.keys ?? []
  ).map(...)
```

et retirer les imports devenus inutiles `ItoMode` et `getItoModeShortcuts`.

- [ ] **Step 5: Router les deux pages**

Dans `app/components/home/HomeKit.tsx`, dans `renderContent()` :

```tsx
      case 'modes':
        return <ModesContent />
      case 'models':
        return <ModelsSettingsContent />
```

avec les imports correspondants, et dans `app/store/useMainStore.ts` ligne 4 :

```typescript
type PageType =
  | 'home'
  | 'modes'
  | 'models'
  | 'dictionary'
  | 'notes'
  | 'settings'
  | 'about'
```

Dans `app/components/home/contents/SettingsContent.tsx`, retirer `'models'` du type `SettingsPage`, l'entrée `{ id: 'models', … }` de `TABS`, le `case 'models'` et l'import `ModelsSettingsContent`.

- [ ] **Step 6: Vérifier visuellement**

Run: `bun dev`

Vérifier :
1. La sidebar montre **Home / Modes / Models / Dictionary / Notes / Settings / About**.
2. Modes liste six lignes, la première portant une pastille verte.
3. Cliquer la pastille d'un autre mode la déplace.
4. « Create mode » ouvre la liste des six presets.
5. Settings n'a plus d'onglet Models.

- [ ] **Step 7: Commit**

```bash
git add app/components/home/contents/ModesContent.tsx app/components/home/contents/modes/ app/components/home/HomeShell.tsx app/components/home/HomeKit.tsx app/store/useMainStore.ts app/components/home/contents/SettingsContent.tsx
git commit -m "feat(modes): Modes and Models become sidebar pages"
```

---

### Task 1.10 : Éditeur de mode

**Files:**
- Create: `app/components/home/contents/modes/ModeEditor.tsx`
- Create: `app/components/home/contents/modes/PresetSelect.tsx`
- Create: `app/components/home/contents/modes/LanguageSelect.tsx`
- Create: `app/components/home/contents/modes/ModelSelect.tsx`

**Interfaces:**
- Consumes: `useModesStore`, `MODE_PRESETS`, `MODE_LANGUAGES`, `VOICE_MODELS`/`TEXT_MODELS` du catalogue
- Produces: `<ModeEditor modeId={string} onBack={() => void} />`

- [ ] **Step 1: Écrire `LanguageSelect.tsx`**

```tsx
import { MODE_LANGUAGES } from '@/lib/constants/modeLanguages'
import type { ModeLanguage } from '@/lib/constants/modeLanguages'
import { CONTROL_WIDTH } from '@/app/components/ui/settings'
import { cn } from '@/lib/utils'

/**
 * Le drapeau porte l'information plus vite que le libellé, mais ne la porte
 * pas seule : « Automatic » n'a pas de pays, et un drapeau isolé confond
 * langue et nation. Les deux sont donc toujours affichés ensemble.
 */
export default function LanguageSelect({
  value,
  onChange,
}: {
  value: ModeLanguage
  onChange: (language: ModeLanguage) => void
}) {
  return (
    <select
      value={value}
      onChange={event => onChange(event.target.value as ModeLanguage)}
      className={cn(
        'rounded-lg border border-border bg-transparent px-2 py-1 text-xs text-foreground',
        CONTROL_WIDTH,
      )}
    >
      {MODE_LANGUAGES.map(language => (
        <option key={language.key} value={language.key}>
          {language.flag} {language.label}
        </option>
      ))}
    </select>
  )
}
```

- [ ] **Step 2: Écrire `ModelSelect.tsx`**

```tsx
import { VOICE_MODELS, TEXT_MODELS } from '@/lib/constants/modelCatalog'
import { CONTROL_WIDTH } from '@/app/components/ui/settings'
import { cn } from '@/lib/utils'

/**
 * Un sélecteur de modèle, restreint aux modèles dont la clé fournisseur est
 * présente : proposer un modèle injoignable produit un échec au moment de la
 * dictée, c'est-à-dire au pire moment.
 */
export default function ModelSelect({
  kind,
  value,
  availableProviders,
  onChange,
}: {
  kind: 'voice' | 'text'
  value: string | null
  availableProviders: Set<string>
  onChange: (key: string | null) => void
}) {
  const models = (kind === 'voice' ? VOICE_MODELS : TEXT_MODELS).filter(model =>
    availableProviders.has(model.provider),
  )

  return (
    <select
      value={value ?? ''}
      onChange={event => onChange(event.target.value || null)}
      className={cn(
        'rounded-lg border border-border bg-transparent px-2 py-1 text-xs text-foreground',
        CONTROL_WIDTH,
      )}
    >
      <option value="">Default</option>
      {models.map(model => (
        <option key={model.key} value={model.key}>
          {model.label}
        </option>
      ))}
    </select>
  )
}
```

- [ ] **Step 3: Écrire `PresetSelect.tsx`**

```tsx
import { useState } from 'react'
import { MODE_PRESETS, findPreset } from '@/lib/constants/modePresets'
import { Button } from '@/app/components/ui/button'
import { SettingsNote, CONTROL_WIDTH } from '@/app/components/ui/settings'
import { cn } from '@/lib/utils'

/**
 * Le preset reste un sélecteur permanent (décision D5) : en changer réécrit
 * les instructions. Comme c'est destructif, il demande confirmation dès que
 * les instructions ont divergé du gabarit — et le libellé bascule alors sur
 * « Custom », qui dit honnêtement que le lien est rompu.
 */
export default function PresetSelect({
  preset,
  instructions,
  onApply,
}: {
  preset: string
  instructions: string
  onApply: (presetKey: string) => void
}) {
  const [pending, setPending] = useState<string | null>(null)

  const source = findPreset(preset)
  const isCustom = !source || source.instructions !== instructions

  const request = (key: string) => {
    if (key === preset && !isCustom) return
    if (instructions.trim().length > 0 && isCustom) {
      setPending(key)
      return
    }
    onApply(key)
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-5">
        <span className="text-xs font-medium text-foreground">Preset</span>
        <select
          value={isCustom ? 'custom' : preset}
          onChange={event => request(event.target.value)}
          className={cn(
            'rounded-lg border border-border bg-transparent px-2 py-1 text-xs text-foreground',
            CONTROL_WIDTH,
          )}
        >
          {isCustom && <option value="custom">Custom</option>}
          {MODE_PRESETS.map(item => (
            <option key={item.key} value={item.key}>
              {item.label}
            </option>
          ))}
        </select>
      </div>

      {pending && (
        <div className="space-y-1.5 rounded-lg border border-border p-2.5">
          <SettingsNote tone="error">
            Applying “{findPreset(pending)?.label}” replaces the instructions
            you wrote. This cannot be undone.
          </SettingsNote>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                onApply(pending)
                setPending(null)
              }}
            >
              Replace
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPending(null)}
            >
              Keep mine
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Écrire `ModeEditor.tsx`**

```tsx
import { useEffect, useMemo, useState } from 'react'
import { useModesStore } from '@/app/store/useModesStore'
import { useAdvancedSettingsStore } from '@/app/store/useAdvancedSettingsStore'
import { findPreset } from '@/lib/constants/modePresets'
import {
  SettingsCard,
  SettingsGroup,
  SettingsRow,
  SettingsNote,
} from '@/app/components/ui/settings'
import { Input } from '@/app/components/ui/input'
import { Textarea } from '@/app/components/ui/textarea'
import { Switch } from '@/app/components/ui/switch'
import { Button } from '@/app/components/ui/button'
import { ChevronLeft } from '@mynaui/icons-react'
import PresetSelect from './PresetSelect'
import LanguageSelect from './LanguageSelect'
import ModelSelect from './ModelSelect'
import { modeIcon } from './modeIcons'
import type { ModeLanguage } from '@/lib/constants/modeLanguages'

const INSTRUCTIONS_LIMIT = 3500
const ASR_PROMPT_LIMIT = 100

export default function ModeEditor({
  modeId,
  onBack,
}: {
  modeId: string
  onBack: () => void
}) {
  const { modes, update, remove, duplicate } = useModesStore()
  const { groqApiKey, openRouterApiKey } = useAdvancedSettingsStore()
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  const mode = modes.find(item => item.id === modeId)

  const availableProviders = useMemo(() => {
    const providers = new Set<string>()
    if (groqApiKey) providers.add('groq')
    if (openRouterApiKey) providers.add('openrouter')
    return providers
  }, [groqApiKey, openRouterApiKey])

  useEffect(() => {
    if (!mode) onBack()
  }, [mode, onBack])

  if (!mode) return null

  const Icon = modeIcon(mode.icon)
  const set = (patch: Record<string, unknown>) => void update(mode.id, patch)

  const applyPreset = (presetKey: string) => {
    const preset = findPreset(presetKey)
    if (!preset) return
    set({
      preset: preset.key,
      icon: preset.icon,
      instructions: preset.instructions,
      language: preset.language,
      voiceModelKey: preset.voiceModelKey,
      textModelKey: preset.textModelKey,
      useLlm: preset.useLlm,
      contextApplication: preset.contextApplication,
      contextClipboard: preset.contextClipboard,
      contextSelection: preset.contextSelection,
      audioSource: preset.audioSource,
      playbackWhenRecording: preset.playbackWhenRecording,
      autoPaste: preset.autoPaste,
      autocapitalize: preset.autocapitalize,
      identifySpeakers: preset.identifySpeakers,
      asrPrompt: preset.asrPrompt,
    })
  }

  return (
    <div className="px-1.5">
      <div className="mb-3 flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onBack}>
          <ChevronLeft className="size-3.5" />
        </Button>
        <Icon className="size-4 text-[var(--subtle-foreground)]" />
        <Input
          value={mode.name}
          onChange={event => set({ name: event.target.value })}
          className="h-7 max-w-[240px] text-xs"
        />
      </div>

      <SettingsGroup>
        <div className="py-2.5">
          <PresetSelect
            preset={mode.preset}
            instructions={mode.instructions}
            onApply={applyPreset}
          />
        </div>
      </SettingsGroup>

      <SettingsRow
        title="Rewrite the dictation"
        description="Off inserts the raw transcript. Nothing can be invented, and nothing is cleaned up."
      >
        <Switch
          checked={mode.useLlm}
          onCheckedChange={useLlm => set({ useLlm })}
        />
      </SettingsRow>

      {mode.useLlm && (
        <SettingsCard
          title="Custom instructions"
          description="What this mode turns a dictation into. Keep the Role / Instructions / Critical structure — it is what stops the model from answering instead of formatting."
          action={
            <span className="text-[10px] tabular-nums text-[var(--subtle-foreground)]">
              {mode.instructions.length}/{INSTRUCTIONS_LIMIT}
            </span>
          }
        >
          <Textarea
            value={mode.instructions}
            maxLength={INSTRUCTIONS_LIMIT}
            rows={10}
            placeholder="## Role&#10;You are a text formatting AI…"
            onChange={event => set({ instructions: event.target.value })}
          />
        </SettingsCard>
      )}

      <SettingsGroup title="Engine">
        <SettingsRow
          title="Language"
          description="Sent to the voice model and imposed on the output. Automatic detects it, at some cost in accuracy."
        >
          <LanguageSelect
            value={mode.language as ModeLanguage}
            onChange={language => set({ language })}
          />
        </SettingsRow>

        <SettingsRow
          title="Voice model"
          description="Transcribes the recording. Long recordings switch to the file path automatically."
        >
          <ModelSelect
            kind="voice"
            value={mode.voiceModelKey}
            availableProviders={availableProviders}
            onChange={voiceModelKey => set({ voiceModelKey })}
          />
        </SettingsRow>

        {mode.useLlm && (
          <SettingsRow
            title="Text model"
            description="Rewrites the transcript following the instructions above."
          >
            <ModelSelect
              kind="text"
              value={mode.textModelKey}
              availableProviders={availableProviders}
              onChange={textModelKey => set({ textModelKey })}
            />
          </SettingsRow>
        )}
      </SettingsGroup>

      <button
        type="button"
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="mb-2 text-xs font-medium text-[var(--subtle-foreground)] hover:text-foreground"
      >
        {showAdvanced ? '▾' : '▸'} Advanced settings
      </button>

      {showAdvanced && (
        <>
          <SettingsGroup title="Insertion">
            <SettingsRow
              title="Auto paste"
              description="Off copies the result to the clipboard and notifies you instead of typing it at the cursor."
            >
              <Switch
                checked={mode.autoPaste}
                onCheckedChange={autoPaste => set({ autoPaste })}
              />
            </SettingsRow>
            <SettingsRow
              title="Autocapitalize insert"
              description="Capitalize the first word when the cursor starts a sentence."
            >
              <Switch
                checked={mode.autocapitalize}
                onCheckedChange={autocapitalize => set({ autocapitalize })}
              />
            </SettingsRow>
          </SettingsGroup>

          <SettingsCard
            title="Transcription priming"
            description="The voice model mimics this text rather than obeying it: write a sample of the style you dictate in. Your dictionary is appended automatically."
            action={
              <span className="text-[10px] tabular-nums text-[var(--subtle-foreground)]">
                {mode.asrPrompt.length}/{ASR_PROMPT_LIMIT}
              </span>
            }
          >
            <Textarea
              value={mode.asrPrompt}
              maxLength={ASR_PROMPT_LIMIT}
              rows={3}
              onChange={event => set({ asrPrompt: event.target.value })}
            />
          </SettingsCard>

          <SettingsGroup title="Danger zone">
            <SettingsRow title="Duplicate this mode">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void duplicate(mode.id)}
              >
                Duplicate
              </Button>
            </SettingsRow>
            <SettingsRow
              title="Delete this mode"
              description={deleteError || undefined}
            >
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  const result = await remove(mode.id)
                  if (result.ok) onBack()
                  else setDeleteError(result.error ?? 'Could not delete')
                }}
              >
                Delete
              </Button>
            </SettingsRow>
          </SettingsGroup>

          {deleteError && (
            <SettingsNote tone="error">{deleteError}</SettingsNote>
          )}
        </>
      )}
    </div>
  )
}
```

> Les réglages `audioSource`, `playbackWhenRecording` et `identifySpeakers` **ne sont pas exposés ici** : ils arrivent au lot 4 avec la capture système, et un interrupteur qui ne fait rien est pire qu'un interrupteur absent.

- [ ] **Step 5: Vérifier visuellement**

Run: `bun dev`

1. Ouvrir Modes → Intelligent : le preset dit « Intelligent », les instructions montrent les trois sections.
2. Modifier les instructions → le preset bascule sur « Custom ».
3. Reprendre « Message » dans le sélecteur → une confirmation apparaît.
4. Cliquer « Replace » → les instructions deviennent celles de Message.
5. Ouvrir Voice to text : le champ d'instructions est absent (`useLlm` à false).

- [ ] **Step 6: Commit**

```bash
git add app/components/home/contents/modes/
git commit -m "feat(modes): mode editor with preset, language, models and advanced settings"
```

---

### Task 1.11 : Le pipeline lit le mode

**Files:**
- Modify: `lib/main/itoSessionManager.ts:37-91,105-112,131-186`
- Modify: `lib/main/itoStreamController.ts:61-71,137-330`
- Modify: `lib/main/transcription/TranscriptAdjuster.ts` (intégralement)
- Modify: `lib/main/context/ContextGrabber.ts:39-67,118-121`
- Modify: `lib/media/keyboard.ts:230-252`
- Modify: `lib/main/recordingStateNotifier.ts:14-22`
- Modify: `lib/main/itoStreamController.test.ts` (adapter les mocks)

**Interfaces:**
- Consumes: `resolveMode`, `resolveActiveMode` de `lib/main/modes/activeMode.ts`
- Produces:
  - `itoSessionManager.startSession(modeId?: string): Promise<string | null>` — `undefined` = mode actif
  - `itoStreamController.initialize(mode: Mode): Promise<boolean>`
  - `contextGrabber.gatherContext(mode: Mode): Promise<ContextData>`
  - `transcriptAdjuster.adjust(transcript: string, mode: Mode, context: ContextData, advancedSettings: AdvancedSettings): Promise<string>`
  - `LocalTranscriptionResult` gagne `modeId: string` et `modeName: string`

- [ ] **Step 1: Adapter les mocks du test existant**

Dans `lib/main/itoStreamController.test.ts`, ajouter après le mock de `./store` :

```typescript
const testMode = (overrides: Record<string, unknown> = {}) => ({
  id: 'intelligent',
  userId: 'self-hosted',
  name: 'Intelligent',
  preset: 'intelligent',
  icon: 'Sparkles',
  instructions: '## Role\nFormat.',
  language: 'fr',
  voiceModelKey: 'whisper-large-v3-turbo',
  textModelKey: 'gpt-5-6-luna',
  useLlm: true,
  contextApplication: false,
  contextClipboard: false,
  contextSelection: false,
  audioSource: 'microphone',
  playbackWhenRecording: 'mute',
  autoPaste: true,
  autocapitalize: true,
  identifySpeakers: false,
  asrPrompt: '',
  sortOrder: 0,
  createdAt: '2026-08-14T00:00:00.000Z',
  updatedAt: '2026-08-14T00:00:00.000Z',
  ...overrides,
})
```

Remplacer chaque `await controller.initialize(ItoMode.TRANSCRIBE)` par `await controller.initialize(testMode())`, et dans le bloc `engine routing`, remplacer `withOpenRouter({...})` par une variante qui passe le mode :

```typescript
    const longAudio = () =>
      mockLocalAudioProcessor.prepareAudioForTranscription.mockReturnValue({
        wavAudio: Buffer.from('wav'),
        sampleRate: 16000,
        durationMs: 120_000,
      })

    const openRouterMode = (overrides: Record<string, unknown> = {}) =>
      testMode({ voiceModelKey: 'gpt-transcribe', ...overrides })

    const withKeys = (overrides: Record<string, unknown> = {}) =>
      mockGetAdvancedSettings.mockReturnValue({
        ...baseAdvancedSettings(),
        openRouterApiKey: 'sk-or-test',
        ...overrides,
      } as any)
```

Le test « keeps short recordings on Groq » devient « a Groq voice model never reaches OpenRouter » et le test « a lowered threshold routes shorter recordings too » **disparaît** : le seuil n'existe plus (D16). Le supprimer et le remplacer par :

```typescript
    test('the voice model of the mode decides the provider, whatever the duration', async () => {
      withKeys()
      const { ItoStreamController } = await import('./itoStreamController')
      const controller = new ItoStreamController()

      await controller.initialize(openRouterMode())
      await controller.processLocalTranscription()

      expect(mockOpenRouterService.transcribeAudio).toHaveBeenCalledTimes(1)
      expect(
        mockLocalTranscriptionService.transcribeAudio,
      ).not.toHaveBeenCalled()
    })
```

et le test « without an OpenRouter key » devient :

```typescript
    test('an OpenRouter model without a key falls back to Groq rather than failing', async () => {
      withKeys({ openRouterApiKey: '' })
      const { ItoStreamController } = await import('./itoStreamController')
      const controller = new ItoStreamController()

      await controller.initialize(openRouterMode())
      await controller.processLocalTranscription()

      expect(mockOpenRouterService.transcribeAudio).not.toHaveBeenCalled()
      expect(mockLocalTranscriptionService.transcribeAudio).toHaveBeenCalled()
    })
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `bun test --preload lib/__tests__/setup.ts lib/main/itoStreamController.test.ts`
Expected: FAIL — `initialize` attend un `ItoMode`

- [ ] **Step 3: Réécrire `TranscriptAdjuster.ts`**

```typescript
import type { AdvancedSettings } from '../store'
import type { ContextData } from '../context/ContextGrabber'
import type { Mode } from '../sqlite/models'
import { DEFAULT_TEXT_KEY, resolveModel } from '../../constants/modelCatalog'
import { localTranscriptionService } from './LocalTranscriptionService'
import {
  openRouterChatService,
  type ChatMessage,
} from './OpenRouterChatService'
import { buildMessages } from '../modes/promptBuilder'

/**
 * Post-traite un transcript avec le modèle texte du mode.
 *
 * Toute erreur rend le transcript brut. Le post-traitement est une
 * amélioration, jamais une condition : perdre une dictée à cause d'un appel
 * LLM instable serait bien pire qu'insérer un texte plus rugueux.
 */
class TranscriptAdjuster {
  async adjust(
    transcript: string,
    mode: Mode,
    context: ContextData,
    advancedSettings: AdvancedSettings,
  ): Promise<string> {
    if (!transcript) return ''

    // Un mode sans réécriture veut le texte tel quel : pas d'aller-retour LLM.
    if (!mode.useLlm) return transcript.trim()

    const model = resolveModel(
      mode.textModelKey ?? advancedSettings?.textModelKey,
      DEFAULT_TEXT_KEY,
    )
    const messages: ChatMessage[] = await buildMessages(
      transcript,
      mode,
      context,
    )
    const temperature = advancedSettings?.llm?.llmTemperature ?? 0.1
    const maxTokens = transcript.length + 64 > 2048 ? 2048 : undefined

    try {
      const adjusted =
        model.provider === 'openrouter'
          ? await openRouterChatService.complete({
              apiKey: advancedSettings?.openRouterApiKey || '',
              model: model.slug,
              messages,
              temperature,
              maxTokens,
              pinnedProvider: model.pinnedProvider,
            })
          : await localTranscriptionService.complete({
              model: model.slug,
              messages,
              temperature,
              maxTokens,
            })

      return adjusted || transcript
    } catch (error: any) {
      console.error(
        `[TranscriptAdjuster] ${model.provider} adjustment failed (${model.slug}):`,
        error?.message || error,
      )
      return transcript
    }
  }
}

export const transcriptAdjuster = new TranscriptAdjuster()
```

> `buildMessages` est écrit au **lot 2**. Pour que le lot 1 compile et fonctionne, créer dès maintenant `lib/main/modes/promptBuilder.ts` dans sa version minimale ; le lot 2 l'enrichit des exemples et des contextes.

```typescript
// lib/main/modes/promptBuilder.ts — version du lot 1
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
```

- [ ] **Step 4: Adapter `ContextGrabber.ts`**

Remplacer la signature et la logique de sélection (lignes 39-67 et 118-121) :

```typescript
  public async gatherContext(mode: Mode): Promise<ContextData> {
    console.log('[ContextGrabber] Gathering context for mode:', mode.name)

    const { vocabularyWords, dictionaryEntries } = await this.getVocabulary()

    const { windowTitle, appName } = await timingCollector.timeAsync(
      TimingEventName.WINDOW_CONTEXT_GATHER,
      async () => await this.getWindowContext(),
    )

    const contextText = mode.contextSelection
      ? await this.getSelectedText()
      : ''

    const advancedSettings = getAdvancedSettings()

    console.log('[ContextGrabber] Context gathered successfully')

    return {
      vocabularyWords,
      dictionaryEntries,
      windowTitle,
      appName,
      contextText,
      clipboardText: '',
      advancedSettings,
    }
  }
```

Renommer `getContextText(mode)` en `getSelectedText()` et supprimer son garde `if (mode !== ItoMode.EDIT) return ''` (le mode décide désormais en amont). Ajouter `clipboardText: string` à `ContextData` (rempli au lot 2). Retirer l'import de `ItoMode` et ajouter `import type { Mode } from '../sqlite/models'`.

- [ ] **Step 5: Adapter `itoStreamController.ts`**

Remplacer `private currentMode: ItoMode = ItoMode.TRANSCRIBE` par `private currentMode: Mode | null = null`, et :

```typescript
  public async initialize(mode: Mode): Promise<boolean> {
    if (this.audioStreamManager.isCurrentlyStreaming()) {
      log.warn('[ItoStreamController] Stream already in progress.')
      return false
    }

    this.audioStreamManager.initialize()
    this.currentMode = mode
    console.log(
      `[ItoStreamController] Starting new interaction stream in mode "${mode.name}"`,
    )
    return true
  }

  public getCurrentMode(): Mode | null {
    return this.currentMode
  }

  public setMode(mode: Mode) {
    this.currentMode = mode
    console.log(`[ItoStreamController] Mode set to "${mode.name}"`)
  }
```

Dans `processLocalTranscription()`, remplacer la résolution des modèles et le routage :

```typescript
    const mode = this.currentMode
    if (!mode) throw new Error('No mode set on the stream controller')

    const context = await contextGrabber.gatherContext(mode)
    const advancedSettings = getAdvancedSettings()
    const timingEvent = mode.useLlm
      ? TimingEventName.LOCAL_EDIT
      : TimingEventName.LOCAL_TRANSCRIBE

    // …

    const voiceModel = resolveModel(
      mode.voiceModelKey ?? undefined,
      DEFAULT_SHORT_VOICE_KEY,
    )
    const languageHint = asrLanguageHint(mode.language)

    const groqOptions: TranscriptionOptions = {
      asrModel:
        voiceModel.provider === 'groq'
          ? voiceModel.slug
          : resolveModel(undefined, DEFAULT_SHORT_VOICE_KEY).slug,
      vocabulary: context.vocabularyWords,
      noSpeechThreshold: advancedSettings.llm.noSpeechThreshold,
      fileType: 'wav',
      language: languageHint,
      customPrompt: mode.asrPrompt,
    }
```

et remplacer `if (this.shouldUseOpenRouter(advancedSettings, durationMs))` par `if (this.shouldUseOpenRouter(mode, voiceModel, advancedSettings))`, dont le corps devient :

```typescript
  /**
   * OpenRouter sert le modèle vocal du mode quand c'est lui qui l'héberge.
   * Sans clé, tout retombe sur Groq — un modèle injoignable ne doit jamais
   * coûter une dictée.
   */
  private shouldUseOpenRouter(
    mode: Mode,
    voiceModel: CatalogModel,
    advancedSettings: ReturnType<typeof getAdvancedSettings>,
  ): boolean {
    if (voiceModel.provider !== 'openrouter') return false

    if (!advancedSettings.openRouterApiKey?.trim()) {
      console.warn(
        `[ItoStreamController] Mode "${mode.name}" wants ${voiceModel.slug} but no OpenRouter key is configured, using Groq`,
      )
      return false
    }
    return true
  }
```

Le modèle passé à OpenRouter devient `voiceModel.slug`, la langue `languageHint`, et le prompt `mode.asrPrompt`. Le résultat gagne :

```typescript
    return {
      transcript: adjusted,
      audioBuffer: Buffer.alloc(0),
      sampleRate,
      durationMs,
      asrEngine,
      asrFallback,
      modeId: mode.id,
      modeName: mode.name,
    }
```

Retirer les imports `LONG_DICTATION_THRESHOLD_MS`, `DEFAULT_LONG_VOICE_KEY` et `ItoMode` ; ajouter `asrLanguageHint` et `type { Mode }`. Dans `lib/constants/transcription.ts`, supprimer `LONG_DICTATION_THRESHOLD_MS` et `LONG_DICTATION_THRESHOLD_OPTIONS` (garder `UNRECOVERABLE_CODES`).

- [ ] **Step 6: Adapter `itoSessionManager.ts`**

```typescript
  public async startSession(modeId?: string): Promise<string | null> {
    if (this.state !== 'idle') {
      console.log(
        `[itoSessionManager] Ignoring startSession while ${this.state}`,
      )
      return null
    }

    this.state = 'starting'
    this.startPromise = this.doStartSession(modeId)
    try {
      return await this.startPromise
    } finally {
      this.startPromise = null
    }
  }

  private async doStartSession(modeId?: string): Promise<string | null> {
    const mode = modeId ? await resolveMode(modeId) : await resolveActiveMode()
    console.log(`[itoSessionManager] Starting session in mode "${mode.name}"`)
    this.currentMode = mode
    // … le reste identique, avec `itoStreamController.initialize(mode)` et
    //   `recordingStateNotifier.notifyRecordingStarted(mode)`
  }

  public async setMode(modeId: string) {
    if (this.state !== 'starting' && this.state !== 'recording') return
    const mode = await resolveMode(modeId)
    this.currentMode = mode
    itoStreamController.setMode(mode)
    recordingStateNotifier.notifyRecordingStarted(mode)
  }
```

Ajouter un champ `private currentMode: Mode | null = null` et, dans `handleTranscriptionResponse`, passer `mode` aux appels et respecter `autoPaste` :

```typescript
      if (mode?.autoPaste !== false) {
        this.textInserter.insertText(textToInsert)
      } else {
        clipboard.writeText(textToInsert)
        showNotification(
          'Ito — copié',
          'Le résultat est dans le presse-papier.',
        )
      }
```

avec `import { clipboard } from 'electron'`, et une fonction `showNotification` locale identique à celle d'`itoStreamController`.

`this.grammarRulesService.setCaseFirstWord` ne s'applique que si `mode.autocapitalize`.

- [ ] **Step 7: Adapter `keyboard.ts` et `recordingStateNotifier.ts`**

`lib/media/keyboard.ts`, lignes 235 et 242 :

```typescript
      await itoSessionManager.startSession(currentlyHeldShortcut.modeId)
      // …
      void itoSessionManager.setMode(currentlyHeldShortcut.modeId)
```

`lib/main/recordingStateNotifier.ts` :

```typescript
  public notifyRecordingStarted(mode: { id: string; name: string; icon: string }) {
    console.log('[RecordingStateNotifier] Notifying recording started:', {
      mode: mode.name,
    })
    this.sendToWindows(IPC_EVENTS.RECORDING_STATE_UPDATE, {
      isRecording: true,
      modeId: mode.id,
      modeName: mode.name,
      modeIcon: mode.icon,
    })
  }
```

Adapter `RecordingStatePayload` dans `lib/types/ipc.ts` : remplacer `mode?: ItoMode` par `modeId?: string; modeName?: string; modeIcon?: string`.

- [ ] **Step 8: Finir le balayage `ItoMode` — la liste complète**

`ItoMode` disparaît du code interne. Ces consommateurs sont **tous** à traiter dans cette tâche, sinon `tsc` ne repasse jamais à zéro. Liste vérifiée par `grep -rn "ItoMode\|getItoModeShortcuts" lib/ app/ --include=*.ts --include=*.tsx | grep -v generated` :

| Fichier | Ce qu'il faut faire |
|---|---|
| `lib/window/ipcEvents.ts:183, 965` | `startSession(ItoMode.TRANSCRIBE)` → `startSession('voice-to-text')` |
| `lib/media/keyboard.test.ts` | Fixtures `mode: ItoMode.*` → `modeId: '…'` |
| `lib/main/transcription/TranscriptAdjuster.test.ts` | Réécrit pour la signature `adjust(transcript, mode, context, settings)` |
| `app/store/useSettingsStore.ts:14,78,83` | `getItoModeShortcuts(mode)` → `getModeShortcuts(modeId)`, défauts par id |
| `app/components/home/HomeShell.tsx` | Lecture par `modeId === 'voice-to-text'` |
| `app/components/home/contents/HomeContent.tsx` | Idem |
| `app/components/home/contents/NotesContent.tsx` | Idem |
| `app/components/home/contents/settings/KeyboardSettingsContent.tsx` | Réécrit en tâche 1.13 |
| `app/components/welcome/contents/TryItOutContent.tsx` | `getModeShortcuts('voice-to-text')` |
| `app/components/welcome/contents/KeyboardTestContext.tsx` | `getModeShortcuts('voice-to-text')` + `getModeShortcutDefaults(platform)['voice-to-text']` |
| `app/components/welcome/contents/IntroducingIntelligentModeContent.tsx` | `getModeShortcuts('intelligent')` |
| `app/components/ui/multi-shortcut-editor.tsx` | Prop `mode: ItoMode` → `modeId: string` |

> **L'onboarding est l'angle mort de ce lot.** Trois de ses écrans importent `ItoMode` et appellent les helpers de raccourcis. Ils sont encore en thème clair et personne ne les ouvre en développement, donc l'erreur ne se verrait qu'au `tsc` final — ou pire, à la première réinstallation.

- [ ] **Step 9: Lancer les tests**

```bash
bun test --preload lib/__tests__/setup.ts lib/main/itoStreamController.test.ts
bun test --preload lib/__tests__/setup.ts lib/main/itoSessionManager.test.ts
bun test --preload lib/__tests__/setup.ts lib/media/keyboard.test.ts
bun test --preload lib/__tests__/setup.ts lib/main/transcription/TranscriptAdjuster.test.ts
bunx tsc --noEmit -p tsconfig.node.json
```
Expected: 4 suites vertes, 0 erreur node. `itoSessionManager.test.ts` demande d'adapter ses mocks (`startSession('voice-to-text')`).

- [ ] **Step 10: Commit**

```bash
git add lib/main/ lib/media/keyboard.ts lib/types/ipc.ts lib/constants/transcription.ts
git commit -m "refactor(modes): the pipeline is driven by the mode, not by an enum"
```

---

### Task 1.12 : Le mode devient visible pendant et après la dictée

**Files:**
- Modify: `app/components/pill/Pill.tsx:123,145,271-276`
- Modify: `lib/main/interactions/InteractionManager.ts:65-74`
- Modify: `lib/main/itoSessionManager.ts` (passer `modeId`/`modeName`)
- Modify: `app/components/home/contents/HomeContent.tsx:786-809`

- [ ] **Step 1: Persister le mode dans l'historique**

Dans `lib/main/interactions/InteractionManager.ts`, étendre le paramètre `asr` :

```typescript
    asr?: {
      engine?: string
      fallback?: AsrFallback
      modeId?: string
      modeName?: string
    },
```

et l'objet `asrOutput` :

```typescript
        engine: asr?.engine || null,
        fallback: asr?.fallback || null,
        modeId: asr?.modeId || null,
        // Figé : renommer un mode ne doit pas réécrire l'histoire.
        modeName: asr?.modeName || null,
```

Dans `itoSessionManager.handleTranscriptionResponse`, passer `{ engine: result.asrEngine, fallback: result.asrFallback, modeId: result.modeId, modeName: result.modeName }`.

- [ ] **Step 2: Afficher le mode dans l'historique**

Dans `app/components/home/contents/HomeContent.tsx`, après `<EngineBadge …/>` (ligne 791) :

```tsx
                            {interaction.asr_output?.modeName && (
                              <span className="text-[11px] text-muted-foreground/70">
                                {interaction.asr_output.modeName}
                              </span>
                            )}
```

- [ ] **Step 3: Afficher le mode dans la pill**

Dans `app/components/pill/Pill.tsx`, remplacer l'état `recordingMode` par :

```tsx
  const [recordingModeName, setRecordingModeName] = useState<string>('')
```

alimenté depuis `state.modeName`, et remplacer la logique de bordure (lignes 271-276) par un libellé, la bordure restant uniforme :

```tsx
  const modeLabel = recordingModeName || null
```

rendu à côté des barres audio :

```tsx
      {modeLabel && (
        <span className="ml-2 truncate text-[10px] tracking-tight text-[rgba(251,250,249,0.6)]">
          {modeLabel}
        </span>
      )}
```

> Le nom du mode remplace la distinction par bordure : un libellé lisible dit ce qu'une nuance de bordure ne pouvait que suggérer. Supprimer `THEME.border.recordingIntelligent` devenu inutile.

- [ ] **Step 4: Vérifier visuellement**

Run: `bun dev`

1. Dicter avec Ctrl+Win → la pill affiche « Voice to text ».
2. Dicter avec Alt+Ctrl → la pill affiche « Intelligent ».
3. L'historique montre le nom du mode à côté des logos moteur.

- [ ] **Step 5: Lancer les tests touchés**

```bash
bun test --preload lib/__tests__/setup.ts lib/main/interactions/InteractionManager.test.ts
bun test --preload lib/__tests__/setup.ts lib/main/itoSessionManager.test.ts
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add app/components/pill/Pill.tsx lib/main/interactions/InteractionManager.ts lib/main/itoSessionManager.ts app/components/home/contents/HomeContent.tsx
git commit -m "feat(modes): the active mode is named in the pill and in the history"
```

---

### Task 1.13 : Nettoyage des écrans de réglages

**Files:**
- Modify: `app/components/home/contents/settings/ModelsSettingsContent.tsx` (devient référence)
- Modify: `app/components/home/contents/settings/models/ModelTable.tsx` (retirer les slots)
- Modify: `app/components/home/contents/settings/AdvancedSettingsContent.tsx` (élaguer)
- Modify: `app/components/home/contents/settings/KeyboardSettingsContent.tsx` (liste + conflits)
- Modify: `app/store/useSettingsStore.ts` (`modeId`)

- [ ] **Step 1: Élaguer Advanced**

Dans `AdvancedSettingsContent.tsx`, supprimer `PROMPT_FIELDS` en entier et le `SettingsGroup title="Prompts"`, ainsi que les lignes « Transcription language » et « Temperature ». Il reste : « No-speech threshold », « Grammar service », « Accessibility context ».

> Justification à conserver en commentaire : la langue et les prompts appartiennent désormais au mode ; les garder ici créerait deux sources pour la même valeur.

- [ ] **Step 2: Transformer Models en page de référence**

Dans `ModelsSettingsContent.tsx`, supprimer `voiceSlots`, `textSlots`, le `SettingsGroup title="Routing"` et `ThresholdPicker`. Garder les deux `ProviderKeyRow` et remplacer les deux `ModelTable` par des tableaux sans sélection :

```tsx
      <ModelTable
        title="Voice models"
        description="What each model costs and how it scored on real dictations. Pick one per mode, in Modes."
        models={VOICE_MODELS}
        availableProviders={availableProviders}
        onRequestKey={setExpandedProvider}
        showAccuracy
      />

      <ModelTable
        title="Text models"
        description="Used by modes that rewrite the dictation."
        models={TEXT_MODELS}
        availableProviders={availableProviders}
        onRequestKey={setExpandedProvider}
      />
```

Dans `ModelTable.tsx`, rendre la prop `slots` optionnelle et ne rendre les colonnes de pastilles que si elle est fournie ; les lignes ne sont plus cliquables sans slots.

Ajouter un `SettingsGroup title="Defaults"` avec un unique `ModelSelect` sur `textModelKey` (le défaut des nouveaux modes).

- [ ] **Step 3: Lister les raccourcis de modes dans Keyboard**

Réécrire `KeyboardSettingsContent.tsx` :

```tsx
import { useEffect } from 'react'
import { useSettingsStore } from '@/app/store/useSettingsStore'
import { useModesStore } from '@/app/store/useModesStore'
import { usePlatform } from '@/app/hooks/usePlatform'
import { getKeyDisplay } from '@/app/utils/keyboard'
import { SettingsGroup, SettingsRow, SettingsNote } from '@/app/components/ui/settings'
import type { KeyName } from '@/lib/types/keyboard'

/**
 * Les raccourcis de dictée s'éditent dans leur mode. Ils sont listés ici en
 * lecture seule pour une seule raison : avec six modes réglables depuis six
 * écrans, deux modes finiront par réclamer la même combinaison, et le symptôme
 * — « mon raccourci ne fait plus rien » — est le plus pénible à diagnostiquer.
 */
export default function KeyboardSettingsContent() {
  const { keyboardShortcuts } = useSettingsStore()
  const { modes, loaded, load } = useModesStore()
  const platform = usePlatform()

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  const display = (keys: string[]) =>
    keys
      .map(key =>
        getKeyDisplay(key as KeyName, platform, { showDirectionalText: false }),
      )
      .join(' + ')

  const byCombo = new Map<string, string[]>()
  for (const shortcut of keyboardShortcuts) {
    if (!shortcut.keys.length) continue
    const combo = [...shortcut.keys].sort().join('+')
    const name =
      modes.find(mode => mode.id === shortcut.modeId)?.name ?? shortcut.modeId
    byCombo.set(combo, [...(byCombo.get(combo) ?? []), name])
  }
  const conflicts = [...byCombo.entries()].filter(([, names]) => names.length > 1)

  return (
    <div className="px-1.5">
      <SettingsGroup
        title="Mode shortcuts"
        description="Edit these in Modes. A mode without a shortcut is reached through the active mode."
      >
        {keyboardShortcuts.map(shortcut => (
          <SettingsRow
            key={shortcut.id}
            title={
              modes.find(mode => mode.id === shortcut.modeId)?.name ??
              shortcut.modeId
            }
          >
            <span className="rounded border border-border px-1.5 py-px text-[10px] tabular-nums text-[var(--subtle-foreground)]">
              {display(shortcut.keys) || 'None'}
            </span>
          </SettingsRow>
        ))}
      </SettingsGroup>

      {conflicts.length > 0 && (
        <SettingsNote tone="error">
          {conflicts
            .map(([, names]) => `${names.join(' and ')} share a shortcut`)
            .join('. ')}
          . Only the first will ever trigger.
        </SettingsNote>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Adapter `useSettingsStore.ts`**

Remplacer `createKeyboardShortcut(mode: ItoMode)` par `createKeyboardShortcut(modeId: string)`, `getItoModeShortcuts(mode)` par `getModeShortcuts(modeId: string)`, et les défauts `mode: ItoMode.EDIT` / `mode: ItoMode.TRANSCRIBE` par `modeId: 'intelligent'` / `modeId: 'voice-to-text'`. Retirer l'import `ItoMode`.

- [ ] **Step 5: Vérifier**

```bash
bunx tsc --noEmit -p tsconfig.node.json
bunx tsc --noEmit -p tsconfig.web.json 2>&1 | grep -c "error TS"
bunx eslint lib/ app/
bunx electron-vite build
```
Expected: 0 erreur node, ≤ 136 web, eslint silencieux, build complet.

- [ ] **Step 6: Vérification manuelle de bout en bout**

Run: `bun dev`

1. **Le raccourci fonctionne toujours** — Ctrl+Win démarre une dictée. C'est la vérification la plus importante du lot.
2. Alt+Ctrl démarre une dictée en mode Intelligent.
3. Settings → Keyboard liste les deux raccourcis avec le nom de leur mode.
4. Créer un mode, lui donner le même raccourci qu'un autre → l'avertissement de conflit apparaît.
5. Settings → Advanced ne montre plus que trois réglages.
6. Models liste les modèles sans pastilles de sélection.

- [ ] **Step 7: Commit**

```bash
git add app/components/home/contents/settings/ app/store/useSettingsStore.ts
git commit -m "refactor(settings): Models becomes a reference page, Advanced is pruned, Keyboard lists mode shortcuts"
```

---

### Task 1.14 : Raccourci de défilement et mode actif affiché en permanence

**Files:**
- Modify: `lib/main/store.ts` (`SettingsStore` + `defaultValues`)
- Modify: `lib/media/keyboard.ts`
- Modify: `app/components/home/contents/settings/KeyboardSettingsContent.tsx`
- Modify: `app/components/pill/Pill.tsx`
- Modify: `lib/main/recordingStateNotifier.ts`
- Test: `lib/media/cycleShortcut.test.ts`

**Interfaces:**
- Produces:
  - `settings.cycleModeShortcut: KeyName[]` — défaut `['control-left', 'shift-left', 'm']`
  - `IPC_EVENTS.ACTIVE_MODE_UPDATE` — poussé vers la pill à chaque changement de mode actif
  - `recordingStateNotifier.notifyActiveModeChanged(mode: { id; name; icon })`

**Pourquoi ce raccourci existe :** avec un mode actif et six modes, changer de mode demanderait d'ouvrir la fenêtre principale — soit exactement le geste que le mode actif devait éviter. Sans raccourci, la fonctionnalité n'est utilisable qu'en théorie.

- [ ] **Step 1: Écrire le test qui échoue**

```typescript
// lib/media/cycleShortcut.test.ts
import { describe, test, expect, mock, beforeEach } from 'bun:test'

const mockCycle = mock(async () => ({
  id: 'intelligent',
  name: 'Intelligent',
  icon: 'Sparkles',
}))
mock.module('../main/modes/activeMode', () => ({
  cycleActiveMode: mockCycle,
  resolveActiveMode: async () => ({
    id: 'voice-to-text',
    name: 'Voice to text',
    icon: 'Microphone',
  }),
  resolveMode: async () => ({ id: 'voice-to-text', name: 'Voice to text' }),
}))

const mockStartSession = mock(async () => 'id')
mock.module('../main/itoSessionManager', () => ({
  itoSessionManager: {
    startSession: mockStartSession,
    completeSession: mock(async () => {}),
    setMode: mock(async () => {}),
  },
}))

const { matchesCycleShortcut } = await import('./keyboard')

describe('cycle-mode shortcut', () => {
  beforeEach(() => {
    mockCycle.mockClear()
    mockStartSession.mockClear()
  })

  test('matches on an exact key set', () => {
    expect(
      matchesCycleShortcut(
        new Set(['control-left', 'shift-left', 'm']),
        ['control-left', 'shift-left', 'm'],
      ),
    ).toBe(true)
  })

  test('a superset does not match — it would fire inside other combos', () => {
    expect(
      matchesCycleShortcut(
        new Set(['control-left', 'shift-left', 'm', 'a']),
        ['control-left', 'shift-left', 'm'],
      ),
    ).toBe(false)
  })

  test('an unconfigured cycle shortcut never matches', () => {
    expect(matchesCycleShortcut(new Set(['control-left']), [])).toBe(false)
  })

  test('cycling never starts a recording', () => {
    // Le défilement et la dictée partagent le même flux d'événements clavier :
    // une confusion entre les deux enregistrerait à chaque changement de mode.
    expect(mockStartSession).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `bun test --preload lib/__tests__/setup.ts lib/media/cycleShortcut.test.ts`
Expected: FAIL — `matchesCycleShortcut` n'existe pas

- [ ] **Step 3: Implémenter dans `lib/media/keyboard.ts`**

```typescript
/**
 * Le raccourci de défilement se teste avant les raccourcis de dictée, et sur
 * une correspondance **exacte** : un sous-ensemble déclencherait un changement
 * de mode au milieu d'une autre combinaison.
 */
export function matchesCycleShortcut(
  pressed: Set<string>,
  shortcut: string[],
): boolean {
  if (shortcut.length === 0) return false
  if (pressed.size !== shortcut.length) return false
  return shortcut.every(key => pressed.has(normalizeLegacyKey(key)))
}
```

et, dans le gestionnaire d'événement, **avant** la résolution de `currentlyHeldShortcut` :

```typescript
  const { cycleModeShortcut } = store.get(STORE_KEYS.SETTINGS)
  if (
    event.type === 'keydown' &&
    matchesCycleShortcut(pressedKeys, cycleModeShortcut ?? [])
  ) {
    const mode = await cycleActiveMode()
    recordingStateNotifier.notifyActiveModeChanged(mode)
    return
  }
```

Le `return` est essentiel : sans lui, la combinaison retomberait dans la détection des raccourcis de dictée.

Ajouter `cycleModeShortcut: KeyName[]` à `SettingsStore` et `cycleModeShortcut: ['control-left', 'shift-left', 'm']` aux défauts, puis enregistrer ce raccourci auprès du listener natif dans `registerAllHotkeys` :

```typescript
  const hotkeys = [
    ...keyboardShortcuts
      .filter(ks => ks.keys.length > 0)
      .map(shortcut => ({ keys: getKeysToRegister(shortcut) })),
    ...(cycleModeShortcut?.length
      ? [{ keys: getKeysToRegister({ keys: cycleModeShortcut } as any) }]
      : []),
  ]
```

- [ ] **Step 4: Pousser le mode actif vers la pill**

Dans `lib/main/recordingStateNotifier.ts` :

```typescript
  public notifyActiveModeChanged(mode: {
    id: string
    name: string
    icon: string
  }) {
    console.log(`[RecordingStateNotifier] Active mode: ${mode.name}`)
    this.sendToWindows(IPC_EVENTS.ACTIVE_MODE_UPDATE, {
      modeId: mode.id,
      modeName: mode.name,
      modeIcon: mode.icon,
    })
  }
```

Ajouter `ACTIVE_MODE_UPDATE: 'active-mode-update'` à `IPC_EVENTS` et le type `ActiveModePayload` dans `lib/types/ipc.ts`. Appeler cette méthode aussi depuis le canal `modes:set-active` (clic dans la page Modes), sans quoi la pill et la fenêtre principale divergeraient.

- [ ] **Step 5: Afficher le mode actif dans la pill au repos**

Dans `app/components/pill/Pill.tsx` :

```tsx
  const [activeModeName, setActiveModeName] = useState('')

  useEffect(() => {
    void window.api.modes.getActive().then(async id => {
      const modes = await window.api.modes.getAll()
      setActiveModeName(modes.find(mode => mode.id === id)?.name ?? '')
    })

    return window.api.on('active-mode-update', (payload: any) =>
      setActiveModeName(payload.modeName ?? ''),
    )
  }, [])
```

et faire du libellé affiché `recordingModeName || activeModeName` : pendant une dictée, c'est le mode qui l'a démarrée ; au repos, c'est le mode actif.

- [ ] **Step 6: Éditer le raccourci dans Settings → Keyboard**

Ajouter un `SettingsGroup title="Global"` avec une ligne « Change the active mode » utilisant l'éditeur de raccourci existant (`MultiShortcutEditor` ou son composant unitaire — vérifier avec `grep -rn "ShortcutEditor" app/components/`), écrivant dans `settings.cycleModeShortcut`.

- [ ] **Step 7: Lancer les tests et vérifier**

```bash
bun test --preload lib/__tests__/setup.ts lib/media/cycleShortcut.test.ts
bunx tsc --noEmit -p tsconfig.node.json
```
Expected: PASS, 0 erreur

Run: `bun dev`

1. La pill affiche « Voice to text » au repos.
2. Ctrl+Shift+M → elle affiche « Intelligent », puis « Meeting » au coup suivant.
3. Ce raccourci **ne démarre aucun enregistrement**.
4. Cliquer la pastille d'un mode dans la page Modes → la pill se met à jour.

- [ ] **Step 8: Commit**

```bash
git add lib/media/keyboard.ts lib/media/cycleShortcut.test.ts lib/main/store.ts lib/main/recordingStateNotifier.ts lib/types/ipc.ts lib/window/modesIpc.ts app/components/pill/Pill.tsx app/components/home/contents/settings/KeyboardSettingsContent.tsx
git commit -m "feat(modes): cycle the active mode from the keyboard, show it in the pill"
```

---

## Vérification du lot 1

```bash
for f in \
  lib/constants/modePresets.test.ts \
  lib/media/cycleShortcut.test.ts \
  lib/main/sqlite/modesSchema.test.ts \
  lib/main/modes/ModeRepository.test.ts \
  lib/main/modes/modeSeeder.test.ts \
  lib/main/modes/modeSettingsMigration.test.ts \
  lib/main/modes/shortcutMigration.test.ts \
  lib/main/modes/activeMode.test.ts \
  lib/window/modesIpc.test.ts \
  lib/main/itoStreamController.test.ts \
  lib/main/itoSessionManager.test.ts \
  lib/main/interactions/InteractionManager.test.ts ; do
  echo "--- $f"; bun test --preload lib/__tests__/setup.ts "$f" 2>&1 | tail -4
done
```

**Critère de sortie :** tous les fichiers verts, `tsc` node à 0, `tsc` web ≤ 136, et la dictée fonctionne avec les deux raccourcis d'origine.
