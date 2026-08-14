# Lot 5 — Diarisation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre exploitable la séparation des locuteurs : la stocker, l'afficher, permettre de nommer les participants, et donner le bouton `Copy` qui alimente un mode de synthèse par le presse-papier.

**Architecture:** Les segments rendus par Deepgram sont persistés dans `asr_output.speakers`. L'historique gagne une troisième vue — après le résultat et l'original — qui les affiche en blocs horodatés. Un renommage réécrit les libellés en base ; le bouton `Copy` met le transcript nommé dans le presse-papier, où un mode avec le contexte « Copied text » viendra le chercher.

**Tech Stack:** TypeScript, React 19, SQLite (JSON dans `asr_output`).

**Dépend de :** [lot 3](2026-08-14-modes-lot3-format-long.md). La diarisation vient de Deepgram ; sans le chemin fichier, il n'y a rien à afficher.

## Global Constraints

Voir [le plan directeur](2026-08-14-modes-refonte.md#global-constraints).

---

### Task 5.1 : Persister les segments de locuteurs

**Files:**
- Modify: `lib/main/itoStreamController.ts` (`LocalTranscriptionResult.speakerSegments`)
- Modify: `lib/main/itoSessionManager.ts`
- Modify: `lib/main/interactions/InteractionManager.ts`
- Modify: `lib/main/sqlite/repo.ts` (`InteractionsTable.updateSpeakerLabels`)
- Test: `lib/main/interactions/InteractionManager.test.ts` (persistance des segments **uniquement**)
- Test: `lib/main/sqlite/speakerLabels.test.ts` (**nouveau** — le renommage)

> **Deux fichiers de test, pas un.** `InteractionManager.test.ts` remplace le module `../sqlite/repo` en entier (`lib/main/interactions/InteractionManager.test.ts:9-14`, un stub à deux méthodes) : y tester le vrai `updateSpeakerLabels` est impossible, la méthode n'y est jamais chargée. Le renommage se teste dans un fichier dédié qui mocke `../sqlite/utils`, exactement comme `ModeRepository.test.ts`.

**Interfaces:**
- Produces: `asr_output.speakers: SpeakerSegment[] | null`
- Produces: `InteractionsTable.updateSpeakerLabels(id: string, labels: Record<number, string>): Promise<void>`

- [ ] **Step 1: Écrire le test qui échoue**

```typescript
  test('stores the speaker segments when the mode identifies speakers', async () => {
    interactionManager.initialize()
    await interactionManager.createInteraction(
      'summary',
      Buffer.alloc(0),
      16000,
      undefined,
      undefined,
      600_000,
      {
        engine: 'deepgram/nova-3',
        modeId: 'meeting',
        modeName: 'Meeting',
        rawTranscript: 'bonjour tout le monde salut',
        speakers: [
          { speaker: 0, label: 'Speaker 1', startMs: 0, endMs: 900, text: 'bonjour tout le monde' },
          { speaker: 1, label: 'Speaker 2', startMs: 1200, endMs: 1600, text: 'salut' },
        ],
      },
    )

    const [row] = mockUpsert.mock.calls.at(-1)!
    expect(row.asr_output.speakers).toHaveLength(2)
    expect(row.asr_output.speakers[1].label).toBe('Speaker 2')
  })

  test('a dictation without diarization stores no speakers array', async () => {
    interactionManager.initialize()
    await interactionManager.createInteraction(
      'text',
      Buffer.alloc(0),
      16000,
      undefined,
      undefined,
      5000,
      { engine: 'whisper-large-v3-turbo' },
    )

    const [row] = mockUpsert.mock.calls.at(-1)!
    expect(row.asr_output.speakers).toBeNull()
  })

```

Et dans un **nouveau** fichier `lib/main/sqlite/speakerLabels.test.ts`, sur le modèle de `ModeRepository.test.ts` — il mocke `./utils`, pas `./repo`, donc la vraie méthode est bien chargée :

```typescript
// lib/main/sqlite/speakerLabels.test.ts
import { describe, test, expect, mock, beforeEach } from 'bun:test'

let row: any = null
const mockRun = mock(async (_q: string, _p: any[]) => {})
const mockGet = mock(async (_q: string, _p: any[]) => row)

mock.module('./utils', () => ({
  run: mockRun,
  get: mockGet,
  all: mock(async () => []),
}))

const { InteractionsTable } = await import('./repo')

const withSpeakers = (speakers: any[]) => ({
  id: 'i1',
  asr_output: JSON.stringify({ transcript: 't', speakers }),
  llm_output: '{}',
})

describe('InteractionsTable.updateSpeakerLabels', () => {
  beforeEach(() => {
    row = null
    mockRun.mockClear()
    mockGet.mockClear()
  })

  test('renaming a speaker rewrites every one of their segments', async () => {
    row = withSpeakers([
      { speaker: 0, label: 'Speaker 1', startMs: 0, endMs: 900, text: 'a' },
      { speaker: 1, label: 'Speaker 2', startMs: 1000, endMs: 1500, text: 'b' },
      { speaker: 0, label: 'Speaker 1', startMs: 2000, endMs: 2500, text: 'c' },
    ])

    await InteractionsTable.updateSpeakerLabels('i1', { 0: 'Cindy', 1: 'Jeremy' })

    const [, params] = mockRun.mock.calls.at(-1)!
    expect(JSON.parse(params[0]).speakers.map((s: any) => s.label)).toEqual([
      'Cindy',
      'Jeremy',
      'Cindy',
    ])
  })

  test('renaming only some speakers leaves the others alone', async () => {
    row = withSpeakers([
      { speaker: 0, label: 'Speaker 1', startMs: 0, endMs: 1, text: 'a' },
      { speaker: 1, label: 'Speaker 2', startMs: 1, endMs: 2, text: 'b' },
    ])

    await InteractionsTable.updateSpeakerLabels('i1', { 0: 'Cindy' })

    const [, params] = mockRun.mock.calls.at(-1)!
    expect(JSON.parse(params[0]).speakers[1].label).toBe('Speaker 2')
  })

  test('an empty name is ignored rather than blanking the label', async () => {
    row = withSpeakers([
      { speaker: 0, label: 'Speaker 1', startMs: 0, endMs: 1, text: 'a' },
    ])

    await InteractionsTable.updateSpeakerLabels('i1', { 0: '   ' })

    const [, params] = mockRun.mock.calls.at(-1)!
    expect(JSON.parse(params[0]).speakers[0].label).toBe('Speaker 1')
  })

  test('an interaction without speakers is a no-op, not a crash', async () => {
    row = { id: 'i1', asr_output: JSON.stringify({ transcript: 't' }), llm_output: '{}' }

    await InteractionsTable.updateSpeakerLabels('i1', { 0: 'Cindy' })

    expect(mockRun).not.toHaveBeenCalled()
  })

  test('the rest of asr_output survives the rewrite', async () => {
    row = {
      id: 'i1',
      asr_output: JSON.stringify({
        transcript: 't',
        rawTranscript: 'raw',
        modeName: 'Meeting',
        speakers: [{ speaker: 0, label: 'Speaker 1', startMs: 0, endMs: 1, text: 'a' }],
      }),
      llm_output: '{}',
    }

    await InteractionsTable.updateSpeakerLabels('i1', { 0: 'Cindy' })

    const stored = JSON.parse(mockRun.mock.calls.at(-1)![1][0])
    expect(stored.rawTranscript).toBe('raw')
    expect(stored.modeName).toBe('Meeting')
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `bun test --preload lib/__tests__/setup.ts lib/main/interactions/InteractionManager.test.ts`
Expected: FAIL

- [ ] **Step 3: Implémenter**

Dans `lib/main/interactions/InteractionManager.ts`, étendre le paramètre `asr` avec `speakers?: SpeakerSegment[]` et l'objet `asrOutput` :

```typescript
        speakers: asr?.speakers?.length ? asr.speakers : null,
```

Dans `lib/main/sqlite/repo.ts`, ajouter à `InteractionsTable` :

```typescript
  /**
   * Renomme des locuteurs dans une interaction.
   *
   * Les segments portent un index (stable dans l'enregistrement) et un
   * libellé (affiché). Renommer réécrit le libellé de **tous** les segments
   * du locuteur : c'est ce qui transforme un transcript en « Speaker 2 »
   * partout en un compte-rendu nommé.
   */
  static async updateSpeakerLabels(
    id: string,
    labels: Record<number, string>,
  ): Promise<void> {
    const interaction = await InteractionsTable.findById(id)
    const speakers = interaction?.asr_output?.speakers
    if (!Array.isArray(speakers)) return

    const renamed = speakers.map((segment: any) => ({
      ...segment,
      label: labels[segment.speaker]?.trim() || segment.label,
    }))

    await run(
      'UPDATE interactions SET asr_output = ?, updated_at = ? WHERE id = ?',
      [
        JSON.stringify({ ...interaction!.asr_output, speakers: renamed }),
        new Date().toISOString(),
        id,
      ],
    )
  }
```

Exposer le canal `interactions:rename-speakers` dans `lib/window/ipcEvents.ts`, le preload et `IpcApi`.

- [ ] **Step 4: Lancer les deux fichiers de test**

```bash
bun test --preload lib/__tests__/setup.ts lib/main/interactions/InteractionManager.test.ts
bun test --preload lib/__tests__/setup.ts lib/main/sqlite/speakerLabels.test.ts
```
Expected: PASS des deux côtés

- [ ] **Step 5: Commit**

```bash
git add lib/main/ lib/window/ipcEvents.ts lib/preload/api.ts app/index.d.ts
git commit -m "feat(diarization): persist speaker segments and allow renaming them"
```

---

### Task 5.2 : Vue Speakers dans l'historique

**Files:**
- Create: `app/components/home/contents/history/SpeakersView.tsx`
- Modify: `app/components/home/contents/HomeContent.tsx`

**Interfaces:**
- Consumes: `asr_output.speakers`, `window.api.interactions.renameSpeakers`
- Produces: `<SpeakersView interactionId segments onRenamed />`

- [ ] **Step 1: Écrire `SpeakersView.tsx`**

```tsx
import { useMemo, useState } from 'react'
import { Button } from '@/app/components/ui/button'
import { Input } from '@/app/components/ui/input'
import { SettingsNote } from '@/app/components/ui/settings'

export type SpeakerSegment = {
  speaker: number
  label: string
  startMs: number
  endMs: number
  text: string
}

const timestamp = (ms: number) => {
  const total = Math.round(ms / 1000)
  const minutes = String(Math.floor(total / 60)).padStart(2, '0')
  const seconds = String(total % 60).padStart(2, '0')
  return `${minutes}:${seconds}`
}

/**
 * Le transcript découpé par locuteur.
 *
 * Le bouton « Copy » est le maillon qui rend la diarisation utile : il place
 * le transcript **nommé** dans le presse-papier, où un mode avec le contexte
 * « Copied text » viendra le chercher pour en faire un compte-rendu par
 * participant. Sans lui, on aurait une jolie vue et aucun moyen de s'en
 * servir.
 */
export default function SpeakersView({
  interactionId,
  segments,
  onRenamed,
}: {
  interactionId: string
  segments: SpeakerSegment[]
  onRenamed: () => void
}) {
  const [renaming, setRenaming] = useState(false)
  const [copied, setCopied] = useState(false)

  const speakers = useMemo(() => {
    const seen = new Map<number, string>()
    for (const segment of segments) {
      if (!seen.has(segment.speaker)) seen.set(segment.speaker, segment.label)
    }
    return [...seen.entries()].map(([speaker, label]) => ({ speaker, label }))
  }, [segments])

  const [drafts, setDrafts] = useState<Record<number, string>>({})

  const asText = () =>
    segments
      .map(
        segment =>
          `[${timestamp(segment.startMs)}-${timestamp(segment.endMs)}] ${segment.label}: ${segment.text}`,
      )
      .join('\n')

  const copy = async () => {
    await navigator.clipboard.writeText(asText())
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const save = async () => {
    await window.api.interactions.renameSpeakers(interactionId, drafts)
    setRenaming(false)
    onRenamed()
  }

  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setDrafts(
              Object.fromEntries(speakers.map(s => [s.speaker, s.label])),
            )
            setRenaming(!renaming)
          }}
        >
          {renaming ? 'Cancel' : 'Rename speakers'}
        </Button>
        {copied && (
          <SettingsNote>
            Now dictate in a mode with “Copied text” switched on to summarize it.
          </SettingsNote>
        )}
      </div>

      {renaming && (
        <div className="space-y-1.5 rounded-lg border border-border p-2.5">
          {speakers.map(speaker => (
            <div key={speaker.speaker} className="flex items-center gap-2">
              <span className="w-20 shrink-0 text-[11px] text-[var(--subtle-foreground)]">
                {speaker.label}
              </span>
              <Input
                className="h-7 text-xs"
                value={drafts[speaker.speaker] ?? ''}
                placeholder="Name"
                onChange={event =>
                  setDrafts(previous => ({
                    ...previous,
                    [speaker.speaker]: event.target.value,
                  }))
                }
              />
            </div>
          ))}
          <Button size="sm" onClick={save}>
            Save
          </Button>
        </div>
      )}

      <div className="space-y-1.5">
        {segments.map((segment, index) => (
          <div key={`${segment.startMs}-${index}`} className="flex gap-2">
            <span className="w-24 shrink-0 text-[10px] tabular-nums text-[var(--subtle-foreground)]">
              {timestamp(segment.startMs)}–{timestamp(segment.endMs)}
            </span>
            <span className="min-w-0">
              <span className="mr-1.5 text-[11px] font-medium text-foreground">
                {segment.label}
              </span>
              <span className="text-[11px] leading-snug text-[var(--muted-foreground)]">
                {segment.text}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Passer d'une bascule à deux états à un sélecteur à trois**

Dans `HomeContent.tsx`, remplacer l'état `showingRaw: Set<string>` par :

```tsx
  type HistoryView = 'result' | 'original' | 'speakers'
  const [views, setViews] = useState<Record<string, HistoryView>>({})

  const viewOf = (interaction: Interaction): HistoryView =>
    views[interaction.id] ?? 'result'

  const availableViews = (interaction: Interaction): HistoryView[] => {
    const list: HistoryView[] = ['result']
    if (interaction.asr_output?.rawTranscript) list.push('original')
    if (interaction.asr_output?.speakers?.length) list.push('speakers')
    return list
  }
```

et remplacer le bouton « Show original » par un groupe de trois, rendu **seulement quand plus d'une vue est disponible** :

```tsx
                            {availableViews(interaction).length > 1 &&
                              availableViews(interaction).map(view => (
                                <button
                                  key={view}
                                  type="button"
                                  onClick={() =>
                                    setViews(previous => ({
                                      ...previous,
                                      [interaction.id]: view,
                                    }))
                                  }
                                  className={cn(
                                    'text-[11px] underline-offset-2 hover:underline',
                                    viewOf(interaction) === view
                                      ? 'text-foreground'
                                      : 'text-muted-foreground/70',
                                  )}
                                >
                                  {view === 'result'
                                    ? 'Result'
                                    : view === 'original'
                                      ? 'Original'
                                      : 'Speakers'}
                                </button>
                              ))}
```

Dans le corps de la ligne, brancher la vue Speakers :

```tsx
                          {viewOf(interaction) === 'speakers' ? (
                            <SpeakersView
                              interactionId={interaction.id}
                              segments={interaction.asr_output.speakers}
                              onRenamed={() => void loadInteractions()}
                            />
                          ) : (
                            /* … le rendu texte existant, avec shownText */
                          )}
```

où `shownText` lit `rawTranscript` quand la vue est `original`.

> `loadInteractions` est la fonction de rechargement existante de `HomeContent`. Vérifier son nom exact avec `grep -n "const load" app/components/home/contents/HomeContent.tsx`.

- [ ] **Step 3: Vérifier visuellement**

Run: `bun dev`

1. Enregistrer une réunion en mode Meeting (ou traiter un fichier à deux voix via « Transcribe a file »).
2. La ligne d'historique propose **Result / Original / Speakers**.
3. Speakers montre des blocs horodatés avec « Speaker 1 » et « Speaker 2 ».
4. « Rename speakers » → saisir deux prénoms → Save → tous les blocs sont renommés.
5. « Copy » → coller dans un éditeur : le transcript nommé et horodaté est là.

- [ ] **Step 4: Commit**

```bash
git add app/components/home/contents/
git commit -m "feat(history): speakers view with bulk renaming and copy"
```

---

### Task 5.3 : Boucler le workflow de compte-rendu

**Files:**
- Modify: `lib/constants/modePresets.ts` (ajouter un septième preset)
- **Aucun changement dans `modeSeeder.ts`** : `meeting-summary` n'est pas semé, il est seulement proposé à la création.

**Interfaces:**
- Produces: le preset `meeting-summary`, disponible à la création mais **non semé**

- [ ] **Step 1: Écrire le test qui échoue**

Dans `lib/constants/modePresets.test.ts` :

```typescript
  test('the meeting summary preset exists, reads the clipboard, and does not paste', () => {
    const preset = findPreset('meeting-summary')!

    expect(preset).toBeDefined()
    expect(preset.contextClipboard).toBe(true)
    // Le compte-rendu ne doit pas atterrir au curseur : il va au presse-papier.
    expect(preset.autoPaste).toBe(false)
    expect(preset.useLlm).toBe(true)
  })

  test('the seeded set stays at six — the summary preset is offered, not imposed', () => {
    // Un mode qui lit le presse-papier à chaque dictée serait une surprise
    // désagréable s'il arrivait tout seul.
    expect(SEEDED_PRESET_KEYS).toHaveLength(6)
    expect(SEEDED_PRESET_KEYS).not.toContain('meeting-summary')
  })

  test('the templates list grows to seven', () => {
    expect(MODE_PRESETS.map(p => p.key)).toEqual([
      'voice-to-text',
      'intelligent',
      'meeting',
      'meeting-summary',
      'message',
      'mail',
      'blank',
    ])
  })
```

Adapter le test `ships the six templates` du fichier, qui devient celui ci-dessus.

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `bun test --preload lib/__tests__/setup.ts lib/constants/modePresets.test.ts`
Expected: FAIL

- [ ] **Step 3: Ajouter le preset**

`SEEDED_PRESET_KEYS` existe depuis la tâche 1.1 et a reçu `meeting` à la tâche 3.3ter — **ne pas y toucher ici**. Ce lot n'ajoute qu'un gabarit proposé.

Une septième entrée dans `MODE_PRESETS`, après `meeting` :

```typescript
  {
    key: 'meeting-summary',
    label: 'Meeting summary',
    description:
      'Reads a speaker-separated transcript from your clipboard and turns it into a structured summary.',
    icon: 'UsersGroup',
    instructions: `## Role
You summarize a meeting transcript provided in the copied text. Your ONLY function is to structure it.

## Instructions
1. Create one section per speaker, with a heading and bullet points for their main contributions.
2. Include timestamps for the most important points, using the ones in the transcript.
3. End with an "Action items" section listing tasks, decisions and follow-ups, naming who is responsible when the information is available.

## Critical
You never invent contributions, decisions or names absent from the transcript. The spoken message is only a trigger — the content to summarize is the copied text.

${LANGUAGE_CLAUSE}`,
    language: 'fr',
    voiceModelKey: 'whisper-large-v3-turbo',
    textModelKey: 'gpt-5-6-luna',
    useLlm: true,
    contextApplication: false,
    contextClipboard: true,
    contextSelection: false,
    audioSource: 'microphone',
    playbackWhenRecording: 'mute',
    // Un compte-rendu de plusieurs paragraphes tapé au curseur atterrirait
    // n'importe où : il va au presse-papier.
    autoPaste: false,
    autocapitalize: false,
    identifySpeakers: false,
    asrPrompt: '',
  },
```

- [ ] **Step 4: Lancer les tests**

```bash
bun test --preload lib/__tests__/setup.ts lib/constants/modePresets.test.ts
bun test --preload lib/__tests__/setup.ts lib/main/modes/modeSeeder.test.ts
```
Expected: PASS

- [ ] **Step 5: Vérification manuelle du workflow complet**

Run: `bun dev`

1. Enregistrer ou importer une réunion à deux voix en mode Meeting.
2. Historique → vue Speakers → renommer les deux locuteurs → **Copy**.
3. Modes → Create mode → **Meeting summary**.
4. Rendre ce mode actif, dicter « traite cette réunion ».
5. Une notification annonce que le résultat est dans le presse-papier ; coller dans un éditeur : un compte-rendu par participant avec une section d'actions.

- [ ] **Step 6: Commit**

```bash
git add lib/constants/modePresets.ts lib/constants/modePresets.test.ts
git commit -m "feat(modes): meeting summary preset closing the diarization workflow"
```

---

## Vérification du lot 5 et du chantier complet

```bash
for f in $(git ls-files 'lib/**/*.test.ts'); do
  echo "--- $f"; bun test --preload lib/__tests__/setup.ts "$f" 2>&1 | tail -3
done

bunx tsc --noEmit -p tsconfig.node.json
bunx tsc --noEmit -p tsconfig.web.json 2>&1 | grep -c "error TS"
bunx eslint lib/ app/
bunx prettier --check lib/ app/
cd native && cargo test --workspace && cargo clippy --workspace -- -D warnings && cd ..
bunx electron-vite build
```

**Critère de sortie du chantier :** partant d'une réunion Google Meet, Caleb obtient un compte-rendu nommé par participant sans quitter Ito — enregistrement système mixé au micro, transcription au-delà de 13 minutes, séparation des locuteurs, renommage, synthèse par un mode qu'il a créé lui-même.
