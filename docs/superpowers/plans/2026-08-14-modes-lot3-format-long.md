# Lot 3 — Format long

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faire sauter le plafond des 13 min 40 s en ajoutant un troisième chemin de transcription — un vrai upload de fichier vers Deepgram — et permettre de soumettre un enregistrement fait ailleurs.

**Architecture:** Un `transcriptionRouter` unique décide, à partir du modèle du mode et de la durée, lequel des trois chemins prend l'audio : Groq multipart (court, rapide), OpenRouter base64 (moyen, précis), Deepgram multipart (long, diarisant). Une troisième clé API rejoint les deux existantes, chiffrée de la même manière.

**Tech Stack:** TypeScript, `fetch` Node, API Deepgram `/v1/listen`.

**Dépend de :** [lot 1](2026-08-14-modes-lot1-visibilite.md).

## Global Constraints

Voir [le plan directeur](2026-08-14-modes-refonte.md#global-constraints). Deux rappels qui mordent ici :

- **La décision « deux clés au total » est explicitement rouverte** (D9). Une troisième clé, Deepgram, est assumée.
- **Une dictée n'est jamais perdue.** Tout échec du chemin fichier laisse le WAV dans `pendingDictationStore` et remonte une erreur nommée.

---

### Task 3.1 : La troisième clé API

**Files:**
- Modify: `lib/main/store.ts:22` (`ENCRYPTED_API_KEY_FIELDS`), interface `AdvancedSettings`, `defaultValues`
- Modify: `app/store/useAdvancedSettingsStore.ts`
- Modify: `app/components/home/contents/settings/ModelsSettingsContent.tsx`
- Modify: `lib/window/ipcEvents.ts` (canal `test-deepgram-api-key`)
- Modify: `lib/preload/api.ts`, `app/index.d.ts`
- Test: `lib/main/deepgramKey.test.ts`

**Interfaces:**
- Produces: `advancedSettings.deepgramApiKey`, chiffrée via `safeStorage` comme les deux autres ; `window.api.testDeepgramApiKey(key)`

- [ ] **Step 1: Écrire le test qui échoue**

```typescript
// lib/main/deepgramKey.test.ts
import { describe, test, expect } from 'bun:test'
import { ENCRYPTED_API_KEY_FIELDS } from './store'

describe('Deepgram key storage', () => {
  test('the Deepgram key is encrypted at rest like the other two', () => {
    expect([...ENCRYPTED_API_KEY_FIELDS]).toEqual([
      'groqApiKey',
      'openRouterApiKey',
      'deepgramApiKey',
    ])
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `bun test --preload lib/__tests__/setup.ts lib/main/deepgramKey.test.ts`
Expected: FAIL — `ENCRYPTED_API_KEY_FIELDS` n'est pas exporté / ne contient que deux entrées

- [ ] **Step 3: Implémenter**

Dans `lib/main/store.ts` :

```typescript
export const ENCRYPTED_API_KEY_FIELDS = [
  'groqApiKey',
  'openRouterApiKey',
  'deepgramApiKey',
] as const
```

Ajouter `deepgramApiKey?: string` à `AdvancedSettings` et `deepgramApiKey: ''` à `defaultValues.advancedSettings`. Ajouter `deepgramApiKey` et `setDeepgramApiKey` dans `app/store/useAdvancedSettingsStore.ts`, sur le modèle exact de `openRouterApiKey`.

Dans `lib/window/ipcEvents.ts`, à côté de `test-openrouter-api-key` :

```typescript
  handleIPC('test-deepgram-api-key', async (_e, apiKey: string) => {
    const { deepgramTranscriptionService } = await import(
      '../main/transcription/DeepgramTranscriptionService'
    )
    try {
      return await deepgramTranscriptionService.testConnection(apiKey)
    } catch (error: any) {
      return { ok: false, message: error?.message || 'Unable to test key' }
    }
  })
```

Dans `ModelsSettingsContent.tsx`, une troisième `ProviderKeyRow` :

```tsx
        <ProviderKeyRow
          provider="deepgram"
          name="Deepgram"
          hint="Long recordings and speaker separation — used by the Meeting mode"
          placeholder="Token…"
          consoleUrl="https://console.deepgram.com/"
          storedKey={deepgramApiKey}
          expanded={expandedProvider === 'deepgram'}
          onToggle={() =>
            setExpandedProvider(
              expandedProvider === 'deepgram' ? null : 'deepgram',
            )
          }
          onSave={setDeepgramApiKey}
          onTest={key => window.api.testDeepgramApiKey(key)}
        />
```

Élargir le type `provider` de `ProviderKeyRow` à `'groq' | 'openrouter' | 'deepgram'` et ajouter l'entrée `deepgram` dans `PROVIDER_ICONS` (`app/components/icons/modelLabIcons.tsx`) — le logo Deepgram y est déjà présent sous `MODEL_LAB_ICONS.deepgram`, le réutiliser.

- [ ] **Step 4: Lancer le test et vérifier les types**

```bash
bun test --preload lib/__tests__/setup.ts lib/main/deepgramKey.test.ts
bunx tsc --noEmit -p tsconfig.node.json
```
Expected: PASS, 0 erreur

- [ ] **Step 5: Commit**

```bash
git add lib/main/store.ts lib/main/deepgramKey.test.ts app/store/useAdvancedSettingsStore.ts lib/window/ipcEvents.ts lib/preload/api.ts app/index.d.ts app/components/home/contents/settings/
git commit -m "feat(deepgram): third provider key, encrypted like the others"
```

---

### Task 3.2 : Client Deepgram

**Files:**
- Create: `lib/main/transcription/DeepgramTranscriptionService.ts`
- Test: `lib/main/transcription/DeepgramTranscriptionService.test.ts`

**Interfaces:**
- Consumes: `LocalTranscriptionError` de `./LocalTranscriptionService`
- Produces:
  - `type SpeakerSegment = { speaker: number; label: string; startMs: number; endMs: number; text: string }`
  - `deepgramTranscriptionService.transcribeAudio(wav: Buffer, options): Promise<{ text: string; segments: SpeakerSegment[] }>`
  - `deepgramTranscriptionService.testConnection(apiKey: string): Promise<{ ok: boolean; message?: string }>`

**Contrat HTTP (à confirmer à l'étape 6 avant d'écrire la suite du lot) :**

```
POST https://api.deepgram.com/v1/listen
  ?model=nova-3&smart_format=true&punctuate=true&paragraphs=true
  [&language=fr] [&diarize=true]
Authorization: Token <clé>
Content-Type: audio/wav
Body: les octets WAV bruts (pas de multipart, pas de base64)

Réponse : results.channels[0].alternatives[0].transcript
          results.channels[0].alternatives[0].words[] → { word, start, end, speaker }
```

- [ ] **Step 1: Écrire le test qui échoue**

```typescript
// lib/main/transcription/DeepgramTranscriptionService.test.ts
import { describe, test, expect, mock, beforeEach } from 'bun:test'

let response: any = {}
let status = 200
const calls: { url: string; init: any }[] = []

const originalFetch = globalThis.fetch
beforeEach(() => {
  calls.length = 0
  status = 200
  globalThis.fetch = (async (url: any, init: any) => {
    calls.push({ url: String(url), init })
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Map(),
      json: async () => response,
      text: async () => JSON.stringify(response),
    }
  }) as any
})

const { deepgramTranscriptionService } = await import(
  './DeepgramTranscriptionService'
)

const withWords = (words: any[]) => ({
  results: {
    channels: [
      {
        alternatives: [
          { transcript: words.map(w => w.word).join(' '), words },
        ],
      },
    ],
  },
})

describe('DeepgramTranscriptionService', () => {
  test('sends the raw WAV bytes, never base64 — that is the whole point of this path', async () => {
    response = withWords([{ word: 'bonjour', start: 0, end: 0.5 }])

    await deepgramTranscriptionService.transcribeAudio(Buffer.from('RIFFwav'), {
      apiKey: 'dg-test',
      model: 'nova-3',
      language: 'fr',
    })

    const { url, init } = calls[0]
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Token dg-test')
    expect(init.headers['Content-Type']).toBe('audio/wav')
    expect(Buffer.isBuffer(init.body)).toBe(true)
    expect(url).toContain('model=nova-3')
    expect(url).toContain('language=fr')
  })

  test('automatic language sends no language parameter', async () => {
    response = withWords([{ word: 'hi', start: 0, end: 0.2 }])
    await deepgramTranscriptionService.transcribeAudio(Buffer.from('x'), {
      apiKey: 'dg',
      model: 'nova-3',
    })
    expect(calls[0].url).not.toContain('language=')
  })

  test('diarization is only requested when asked for', async () => {
    response = withWords([{ word: 'hi', start: 0, end: 0.2 }])

    await deepgramTranscriptionService.transcribeAudio(Buffer.from('x'), {
      apiKey: 'dg',
      model: 'nova-3',
      diarize: true,
    })
    expect(calls[0].url).toContain('diarize=true')

    await deepgramTranscriptionService.transcribeAudio(Buffer.from('x'), {
      apiKey: 'dg',
      model: 'nova-3',
    })
    expect(calls[1].url).not.toContain('diarize')
  })

  test('groups consecutive words by speaker into segments', async () => {
    response = withWords([
      { word: 'bonjour', start: 0, end: 0.5, speaker: 0 },
      { word: 'tout', start: 0.5, end: 0.8, speaker: 0 },
      { word: 'le', start: 0.8, end: 0.9, speaker: 0 },
      { word: 'salut', start: 1.2, end: 1.6, speaker: 1 },
      { word: 'oui', start: 2.0, end: 2.2, speaker: 0 },
    ])

    const result = await deepgramTranscriptionService.transcribeAudio(
      Buffer.from('x'),
      { apiKey: 'dg', model: 'nova-3', diarize: true },
    )

    expect(result.segments).toEqual([
      { speaker: 0, label: 'Speaker 1', startMs: 0, endMs: 900, text: 'bonjour tout le' },
      { speaker: 1, label: 'Speaker 2', startMs: 1200, endMs: 1600, text: 'salut' },
      { speaker: 0, label: 'Speaker 1', startMs: 2000, endMs: 2200, text: 'oui' },
    ])
  })

  test('without diarization there are no segments, only text', async () => {
    response = withWords([{ word: 'bonjour', start: 0, end: 0.5 }])
    const result = await deepgramTranscriptionService.transcribeAudio(
      Buffer.from('x'),
      { apiKey: 'dg', model: 'nova-3' },
    )

    expect(result.text).toBe('bonjour')
    expect(result.segments).toEqual([])
  })

  test('a refused key is reported as INVALID_API_KEY, not as a network glitch', async () => {
    status = 401
    response = { err_msg: 'Invalid credentials' }

    await expect(
      deepgramTranscriptionService.transcribeAudio(Buffer.from('x'), {
        apiKey: 'bad',
        model: 'nova-3',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_API_KEY' })
  })

  test('a missing key never reaches the network', async () => {
    await expect(
      deepgramTranscriptionService.transcribeAudio(Buffer.from('x'), {
        apiKey: '  ',
        model: 'nova-3',
      }),
    ).rejects.toMatchObject({ code: 'MISSING_API_KEY' })
    expect(calls).toHaveLength(0)
  })

  test('an empty transcript on real audio is an error, not a silent success', async () => {
    response = withWords([])
    await expect(
      deepgramTranscriptionService.transcribeAudio(Buffer.from('x'), {
        apiKey: 'dg',
        model: 'nova-3',
      }),
    ).rejects.toMatchObject({ code: 'MODEL_ERROR' })
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `bun test --preload lib/__tests__/setup.ts lib/main/transcription/DeepgramTranscriptionService.test.ts`
Expected: FAIL — module absent

- [ ] **Step 3: Écrire le service**

```typescript
import { LocalTranscriptionError } from './LocalTranscriptionService'

/**
 * Le chemin fichier : c'est lui qui fait sauter le plafond des 13 minutes.
 *
 * Les deux autres chemins envoient l'audio dans un corps JSON — en multipart
 * pour Groq, en base64 pour OpenRouter — ce qui plafonne à quelques minutes.
 * Deepgram accepte les octets bruts en corps de requête, donc des heures, et
 * rend en prime la séparation des locuteurs dont le mode Meeting a besoin.
 */

export type SpeakerSegment = {
  /** Index rendu par Deepgram, stable dans un enregistrement. */
  speaker: number
  /** Libellé affiché, renommable par l'utilisateur. */
  label: string
  startMs: number
  endMs: number
  text: string
}

export type DeepgramOptions = {
  apiKey: string
  model: string
  /** ISO-639-1, ou absent pour laisser Deepgram détecter. */
  language?: string
  diarize?: boolean
  /**
   * Type MIME du corps. Les dictées d'Ito sont du WAV ; un fichier importé
   * peut être n'importe quel conteneur, et annoncer le mauvais type fait
   * échouer le décodage côté Deepgram.
   */
  contentType?: string
}

const LISTEN_URL = 'https://api.deepgram.com/v1/listen'
// Une heure d'audio se transcrit en quelques minutes ; la marge couvre une
// réunion longue sur une connexion médiocre.
const REQUEST_TIMEOUT_MS = 900_000

type DeepgramWord = {
  word: string
  start: number
  end: number
  speaker?: number
}

/** Regroupe les mots consécutifs d'un même locuteur en blocs lisibles. */
export function groupWordsBySpeaker(words: DeepgramWord[]): SpeakerSegment[] {
  const segments: SpeakerSegment[] = []

  for (const word of words) {
    if (word.speaker === undefined) continue

    const last = segments.at(-1)
    if (last && last.speaker === word.speaker) {
      last.text += ` ${word.word}`
      last.endMs = Math.round(word.end * 1000)
      continue
    }

    segments.push({
      speaker: word.speaker,
      label: `Speaker ${word.speaker + 1}`,
      startMs: Math.round(word.start * 1000),
      endMs: Math.round(word.end * 1000),
      text: word.word,
    })
  }

  return segments
}

function buildUrl(options: DeepgramOptions): string {
  const params = new URLSearchParams({
    model: options.model,
    smart_format: 'true',
    punctuate: 'true',
    paragraphs: 'true',
  })
  if (options.language) params.set('language', options.language)
  if (options.diarize) params.set('diarize', 'true')
  return `${LISTEN_URL}?${params.toString()}`
}

async function mapHttpError(res: Response): Promise<LocalTranscriptionError> {
  let detail = ''
  try {
    detail = (await res.text()).slice(0, 300)
  } catch {
    // detail reste vide
  }

  if (res.status === 401 || res.status === 403) {
    return new LocalTranscriptionError(
      'Deepgram rejected the API key',
      'INVALID_API_KEY',
      res.status,
    )
  }
  if (res.status === 429) {
    return new LocalTranscriptionError(
      'Deepgram rate limit hit',
      'RATE_LIMIT',
      res.status,
    )
  }
  if (res.status >= 500) {
    return new LocalTranscriptionError(
      `Deepgram server error: ${detail || res.status}`,
      'NETWORK',
      res.status,
    )
  }
  return new LocalTranscriptionError(
    `Deepgram request failed (${res.status}): ${detail}`,
    'MODEL_ERROR',
    res.status,
  )
}

class DeepgramTranscriptionService {
  async transcribeAudio(
    wavAudio: Buffer,
    options: DeepgramOptions,
  ): Promise<{ text: string; segments: SpeakerSegment[] }> {
    const apiKey = options.apiKey?.trim()
    if (!apiKey) {
      throw new LocalTranscriptionError(
        'Deepgram API key is required for long recordings',
        'MISSING_API_KEY',
      )
    }

    let res: Response
    try {
      res = await fetch(buildUrl(options), {
        method: 'POST',
        headers: {
          Authorization: `Token ${apiKey}`,
          'Content-Type': options.contentType || 'audio/wav',
        },
        body: wavAudio,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch (error: any) {
      const timedOut =
        error?.name === 'AbortError' || error?.name === 'TimeoutError'
      throw new LocalTranscriptionError(
        timedOut ? 'Deepgram request timed out' : error?.message || 'Deepgram request failed',
        'NETWORK',
      )
    }

    if (!res.ok) throw await mapHttpError(res)

    let json: any
    try {
      json = await res.json()
    } catch {
      throw new LocalTranscriptionError(
        'Deepgram returned a non-JSON response',
        'MODEL_ERROR',
        res.status,
      )
    }

    const alternative = json?.results?.channels?.[0]?.alternatives?.[0]
    const text: string = (alternative?.transcript || '').trim()

    if (!text) {
      // Un transcript vide sur de la vraie parole est un échec silencieux du
      // moteur ; le laisser passer insérerait du vide sans rien dire.
      throw new LocalTranscriptionError(
        'Deepgram returned an empty transcript',
        'MODEL_ERROR',
        res.status,
      )
    }

    const segments = options.diarize
      ? groupWordsBySpeaker(alternative?.words ?? [])
      : []

    console.log(
      `[Deepgram] model=${options.model} chars=${text.length} segments=${segments.length}`,
    )
    return { text, segments }
  }

  async testConnection(
    apiKey: string,
  ): Promise<{ ok: boolean; message?: string }> {
    if (!apiKey?.trim()) return { ok: false, message: 'Enter an API key first' }

    try {
      const res = await fetch('https://api.deepgram.com/v1/projects', {
        headers: { Authorization: `Token ${apiKey.trim()}` },
        signal: AbortSignal.timeout(10_000),
      })
      if (res.ok) return { ok: true, message: 'Connected to Deepgram' }
      if (res.status === 401 || res.status === 403) {
        return { ok: false, message: 'Invalid Deepgram API key' }
      }
      return { ok: false, message: `Deepgram returned HTTP ${res.status}` }
    } catch (error: any) {
      return { ok: false, message: error?.message || 'Unable to reach Deepgram' }
    }
  }
}

export const deepgramTranscriptionService = new DeepgramTranscriptionService()
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `bun test --preload lib/__tests__/setup.ts lib/main/transcription/DeepgramTranscriptionService.test.ts`
Expected: PASS — 8 tests

- [ ] **Step 5: Restaurer `globalThis.fetch` après les tests**

Ajouter à la fin du fichier de test :

```typescript
import { afterAll } from 'bun:test'
afterAll(() => {
  globalThis.fetch = originalFetch
})
```

- [ ] **Step 6: Confirmer le contrat HTTP contre la vraie API**

> **Étape bloquante.** Les tests ci-dessus valident notre code contre le contrat *supposé*. Avant d'écrire le routeur, confirmer le contrat réel avec un enregistrement de test.

**Il n'existe aucun `.wav` dans `.wayfinder`.** Le seul asset réel est `.wayfinder/assets/015-bakeoff/enregistrement-feature-ito.m4a` (149 s) ; le `.wav` du banc de mesure est un intermédiaire que son README fait générer par ffmpeg et qui n'a pas été conservé. Le régénérer d'abord :

```bash
ffmpeg -y -i .wayfinder/assets/015-bakeoff/enregistrement-feature-ito.m4a \
  -ar 16000 -ac 1 -c:a pcm_s16le /tmp/deepgram-probe.wav
```

```bash
curl -sS -X POST \
  "https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&punctuate=true&diarize=true&language=fr" \
  -H "Authorization: Token $DEEPGRAM_KEY" \
  -H "Content-Type: audio/wav" \
  --data-binary @/tmp/deepgram-probe.wav \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);const a=j.results.channels[0].alternatives[0];console.log('chars:',a.transcript.length);console.log('words:',a.words?.length);console.log('first word:',JSON.stringify(a.words?.[0]));console.log('speakers:',new Set(a.words?.map(w=>w.speaker)).size)})"
```

Vérifier trois choses :

1. `chars` > 0 et le texte est **en français** — c'est le point le moins sûr du contrat : `language=fr` sur `nova-3` est le paramètre à confirmer. S'il rend de l'anglais ou du vide, retirer `language` et laisser Deepgram détecter.
2. `first word` contient bien `word`, `start`, `end`, `speaker`.
3. `speakers` ≥ 1.

Si la forme diffère, corriger `groupWordsBySpeaker` et les tests **avant** de continuer. Le fichier de sonde est temporaire : ne pas l'ajouter au dépôt.

- [ ] **Step 7: Commit**

```bash
git add lib/main/transcription/DeepgramTranscriptionService.ts lib/main/transcription/DeepgramTranscriptionService.test.ts
git commit -m "feat(deepgram): file-path transcription client with speaker grouping"
```

---

### Task 3.3 : Routeur de transcription

**Files:**
- Create: `lib/main/transcription/transcriptionRouter.ts`
- Modify: `lib/main/itoStreamController.ts`
- Modify: `lib/main/transcription/LocalAudioProcessor.ts:24,164-166`
- Test: `lib/main/transcription/transcriptionRouter.test.ts`

**Interfaces:**
- Produces:
  - `const FILE_PATH_THRESHOLD_MS = 480_000` (8 min)
  - `const GROQ_MAX_BYTES = 25 * 1024 * 1024`
  - `type TranscriptionPath = 'groq' | 'openrouter' | 'deepgram'`
  - `chooseTranscriptionPath(input: { voiceModelProvider; durationMs; wavBytes; hasOpenRouterKey; hasDeepgramKey }): { path: TranscriptionPath } | { path: null; reason: string }`

- [ ] **Step 1: Écrire le test qui échoue**

```typescript
// lib/main/transcription/transcriptionRouter.test.ts
import { describe, test, expect } from 'bun:test'
import {
  chooseTranscriptionPath,
  FILE_PATH_THRESHOLD_MS,
} from './transcriptionRouter'

const input = (overrides: Record<string, unknown> = {}) => ({
  voiceModelProvider: 'groq' as const,
  durationMs: 30_000,
  wavBytes: 1_000_000,
  identifySpeakers: false,
  hasOpenRouterKey: true,
  hasDeepgramKey: true,
  ...overrides,
})

describe('chooseTranscriptionPath', () => {
  test('a short dictation on a Groq model goes to Groq', () => {
    expect(chooseTranscriptionPath(input())).toEqual({ path: 'groq' })
  })

  test('a short dictation on an OpenRouter model goes to OpenRouter', () => {
    expect(
      chooseTranscriptionPath(input({ voiceModelProvider: 'openrouter' })),
    ).toEqual({ path: 'openrouter' })
  })

  test('past the threshold, the file path wins whatever the model provider', () => {
    for (const provider of ['groq', 'openrouter'] as const) {
      expect(
        chooseTranscriptionPath(
          input({ voiceModelProvider: provider, durationMs: FILE_PATH_THRESHOLD_MS }),
        ),
      ).toEqual({ path: 'deepgram' })
    }
  })

  test('the threshold is well under the Groq byte ceiling — no recording should ever hit it', () => {
    // 8 min at 16 kHz mono 16-bit ≈ 15 MB, against a 25 MB ceiling.
    expect(FILE_PATH_THRESHOLD_MS).toBeLessThan(13 * 60 * 1000)
  })

  test('a long recording without a Deepgram key still tries, as long as it fits', () => {
    expect(
      chooseTranscriptionPath(
        input({ durationMs: 600_000, wavBytes: 19_000_000, hasDeepgramKey: false }),
      ),
    ).toEqual({ path: 'groq' })
  })

  test('a long recording with neither a Deepgram key nor room in Groq is refused by name', () => {
    const result = chooseTranscriptionPath(
      input({ durationMs: 3_600_000, wavBytes: 115_000_000, hasDeepgramKey: false }),
    )

    expect(result.path).toBeNull()
    expect((result as any).reason).toContain('Deepgram')
  })

  test('an OpenRouter model without its key falls back to Groq', () => {
    expect(
      chooseTranscriptionPath(
        input({ voiceModelProvider: 'openrouter', hasOpenRouterKey: false }),
      ),
    ).toEqual({ path: 'groq' })
  })

  test('an OpenRouter recording too big for base64 goes to the file path', () => {
    expect(
      chooseTranscriptionPath(
        input({
          voiceModelProvider: 'openrouter',
          durationMs: 300_000,
          wavBytes: 10_000_000,
        }),
      ),
    ).toEqual({ path: 'deepgram' })
  })

  test('the byte ceiling follows the provider, not the strictest of them', () => {
    // 10 Mo dépasse le plafond base64 d'OpenRouter mais pas celui de Groq.
    // Appliquer le mauvais ferait changer de moteur une dictée de 5 min sur un
    // modèle Groq, en silence — contraire à D2 et D16.
    expect(
      chooseTranscriptionPath(
        input({ voiceModelProvider: 'groq', durationMs: 300_000, wavBytes: 10_000_000 }),
      ),
    ).toEqual({ path: 'groq' })
  })

  test('a mode that identifies speakers always takes the file path', () => {
    // Deepgram est le seul chemin qui rend words[].speaker : une réunion de
    // deux minutes doit y aller quand même, sinon la vue Speakers est vide.
    expect(
      chooseTranscriptionPath(
        input({ durationMs: 120_000, wavBytes: 3_800_000, identifySpeakers: true }),
      ),
    ).toEqual({ path: 'deepgram' })
  })

  test('speaker identification without a Deepgram key degrades instead of failing', () => {
    expect(
      chooseTranscriptionPath(
        input({
          durationMs: 120_000,
          wavBytes: 3_800_000,
          identifySpeakers: true,
          hasDeepgramKey: false,
        }),
      ),
    ).toEqual({ path: 'groq' })
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `bun test --preload lib/__tests__/setup.ts lib/main/transcription/transcriptionRouter.test.ts`
Expected: FAIL — module absent

- [ ] **Step 3: Écrire le routeur**

```typescript
/**
 * Quel transport prend l'audio.
 *
 * Le seuil n'est pas un réglage (décision D16) : c'est une limite technique,
 * pas une préférence. L'exposer inviterait à le régler au-delà de ce que le
 * transport supporte, ce qui échouerait après la dictée.
 */

/** 8 min ≈ 15 Mo de WAV, contre un plafond Groq de 25 Mo : une vraie marge. */
export const FILE_PATH_THRESHOLD_MS = 480_000

export const GROQ_MAX_BYTES = 25 * 1024 * 1024

/**
 * Au-delà, le corps JSON base64 devient déraisonnable : l'encodage gonfle de
 * 33 % et l'edge d'OpenRouter refuse les corps très gros.
 */
export const OPENROUTER_MAX_BYTES = 6 * 1024 * 1024

export type TranscriptionPath = 'groq' | 'openrouter' | 'deepgram'

export type RouterInput = {
  voiceModelProvider: 'groq' | 'openrouter'
  durationMs: number
  wavBytes: number
  /** Le mode demande la séparation des locuteurs. */
  identifySpeakers: boolean
  hasOpenRouterKey: boolean
  hasDeepgramKey: boolean
}

export type RouterDecision =
  | { path: TranscriptionPath }
  | { path: null; reason: string }

/**
 * Ce que le transport du fournisseur courant accepte. Appliquer le plafond
 * base64 d'OpenRouter à Groq ramènerait le seuil effectif de 8 min à 3 min 17,
 * et ferait changer de moteur une dictée de 4 min sans que rien ne l'annonce.
 */
function transportCeiling(provider: 'groq' | 'openrouter'): number {
  return provider === 'openrouter' ? OPENROUTER_MAX_BYTES : GROQ_MAX_BYTES
}

export function chooseTranscriptionPath(input: RouterInput): RouterDecision {
  // Seul Deepgram rend `words[].speaker` : un mode qui demande la diarisation
  // n'a rien à faire sur les deux autres chemins, quelle que soit la durée.
  const wantsFilePath =
    input.durationMs >= FILE_PATH_THRESHOLD_MS ||
    input.wavBytes > transportCeiling(input.voiceModelProvider) ||
    input.identifySpeakers

  if (wantsFilePath && input.hasDeepgramKey) {
    return { path: 'deepgram' }
  }

  // Pas de clé Deepgram : on tente quand même le chemin court tant que la
  // taille passe. Une dictée transcrite par un moteur imparfait vaut mieux
  // qu'une dictée refusée.
  if (wantsFilePath && input.wavBytes <= GROQ_MAX_BYTES) {
    console.warn(
      '[transcriptionRouter] Long recording without a Deepgram key, falling back to Groq',
    )
    return { path: 'groq' }
  }

  if (wantsFilePath) {
    return {
      path: null,
      reason:
        'This recording is too long to transcribe without a Deepgram API key. Add one in Models.',
    }
  }

  if (input.voiceModelProvider === 'openrouter') {
    if (!input.hasOpenRouterKey) {
      console.warn(
        '[transcriptionRouter] OpenRouter model without a key, falling back to Groq',
      )
      return { path: 'groq' }
    }
    return { path: 'openrouter' }
  }

  return { path: 'groq' }
}
```

- [ ] **Step 4: Lever le plafond de préparation audio**

Dans `lib/main/transcription/LocalAudioProcessor.ts`, remplacer :

```typescript
  private readonly groqMaxBytes = 25 * 1024 * 1024 // 25 MB
```

par :

```typescript
  /**
   * Plafond de sécurité, pas une limite de transport : c'est le routeur qui
   * sait quel transport supporte quoi. Une heure d'audio 16 kHz mono pèse
   * ~115 Mo ; au-delà de 512 Mo on est face à un bug, pas à une réunion.
   */
  private readonly maxBytes = 512 * 1024 * 1024
```

et adapter les deux usages (`options.maxBytes || this.maxBytes`, et le message `'Audio exceeds the 512MB safety limit'`).

- [ ] **Step 5: Brancher le routeur dans `itoStreamController`**

Remplacer `shouldUseOpenRouter` par :

```typescript
    const decision = chooseTranscriptionPath({
      voiceModelProvider: voiceModel.provider,
      durationMs,
      wavBytes: wavAudio.length,
      identifySpeakers: mode.identifySpeakers,
      hasOpenRouterKey: !!advancedSettings.openRouterApiKey?.trim(),
      hasDeepgramKey: !!advancedSettings.deepgramApiKey?.trim(),
    })

    if (decision.path === null) {
      throw new LocalTranscriptionError(decision.reason, 'MODEL_ERROR')
    }
```

et le corps de `timingCollector.timeAsync` :

```typescript
        if (decision.path === 'deepgram') {
          try {
            const result = await this.withRetry(
              `Deepgram (${voiceModel.slug})`,
              OPENROUTER_RETRY,
              () =>
                deepgramTranscriptionService.transcribeAudio(wavAudio, {
                  apiKey: advancedSettings.deepgramApiKey || '',
                  model: 'nova-3',
                  language: languageHint,
                  diarize: mode.identifySpeakers,
                }),
            )
            asrEngine = 'deepgram/nova-3'
            speakerSegments = result.segments
            return result.text
          } catch (error: any) {
            asrFallback = this.recordProviderFallback(
              error,
              'deepgram/nova-3',
              advancedSettings.deepgramApiKey || '',
            )
          }
        } else if (decision.path === 'openrouter') {
          // … le bloc OpenRouter existant, inchangé
        }
        return await this.withRetry('Groq', GROQ_RETRY, () =>
          localTranscriptionService.transcribeAudio(wavAudio, groqOptions),
        )
```

Ajouter `let speakerSegments: SpeakerSegment[] = []` et le porter dans `LocalTranscriptionResult.speakerSegments`.

> Le renommage `openRouterHealth` → `providerHealth` fait l'objet de la **tâche 3.3bis** ci-dessous : il touche sept fichiers et change la forme du réglage stocké.

- [ ] **Step 6: Lancer les tests**

```bash
bun test --preload lib/__tests__/setup.ts lib/main/transcription/transcriptionRouter.test.ts
bun test --preload lib/__tests__/setup.ts lib/main/itoStreamController.test.ts
bun test --preload lib/__tests__/setup.ts lib/main/transcription/LocalAudioProcessor.test.ts
```
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add lib/main/transcription/ lib/main/itoStreamController.ts
git commit -m "feat(transcription): route between Groq, OpenRouter and the Deepgram file path"
```

---

### Task 3.3bis : Généraliser `openRouterHealth` en `providerHealth`

**Files:**
- Rename: `lib/main/transcription/openRouterHealth.ts` → `providerHealth.ts`
- Rename: `lib/main/transcription/openRouterHealth.test.ts` → `providerHealth.test.ts`
- Modify: `lib/main/store.ts` (type `AdvancedSettings`)
- Modify: `lib/main/itoStreamController.ts`
- Modify: `lib/window/ipcEvents.ts` (canal `get-openrouter-failure`)
- Modify: `lib/preload/api.ts`, `app/index.d.ts`
- Modify: `app/components/home/contents/settings/ModelsSettingsContent.tsx`

**Interfaces:**
- Produces:
  - `type Provider = 'openrouter' | 'deepgram'`
  - `getProviderFailure(provider: Provider, apiKey?: string): ProviderFailure | null`
  - `getRejectedKeyFailure(provider: Provider, apiKey?: string): ProviderFailure | null`
  - `recordProviderFailure({ provider, code, message, model, apiKey }): void`
  - `clearProviderFailure(provider: Provider): void`
  - `failureNotice(provider: Provider, code?: string): string`
  - Réglage : `advancedSettings.providerFailures: Partial<Record<Provider, ProviderFailure>>`

**Pourquoi une tâche à part :** le lot 3 ajoute un fournisseur qui peut refuser une clé exactement comme OpenRouter. Sans généralisation, une clé Deepgram morte redonnerait le symptôme que la session précédente vient de corriger — repli silencieux, dix secondes perdues à chaque réunion.

- [ ] **Step 1: Écrire le test de migration du réglage**

Ajouter à `providerHealth.test.ts` :

```typescript
  test('an old single-provider record is read as the OpenRouter one', () => {
    // Le réglage passe d'un objet unique à une map par fournisseur ; les
    // installations existantes portent l'ancienne forme.
    advancedSettings = {
      openRouterFailure: {
        code: 'INVALID_API_KEY',
        message: 'refused',
        model: 'x',
        at: '2026-08-14T00:00:00.000Z',
        keyFingerprint: fingerprintOf(KEY),
      },
    }

    expect(getProviderFailure('openrouter', KEY)?.code).toBe('INVALID_API_KEY')
    expect(getProviderFailure('deepgram', KEY)).toBeNull()
  })

  test('each provider keeps its own record', () => {
    recordProviderFailure({
      provider: 'deepgram',
      code: 'INVALID_API_KEY',
      message: 'refused',
      model: 'deepgram/nova-3',
      apiKey: KEY,
    })

    const [path] = mockStoreSet.mock.calls.at(-1)!
    expect(path).toBe('advancedSettings.providerFailures.deepgram')
  })

  test('the notice names the provider that failed', () => {
    expect(failureNotice('deepgram', 'INVALID_API_KEY')).toContain('Deepgram')
    expect(failureNotice('openrouter', 'INVALID_API_KEY')).toContain('OpenRouter')
  })
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `bun test --preload lib/__tests__/setup.ts lib/main/transcription/providerHealth.test.ts`
Expected: FAIL

- [ ] **Step 3: Généraliser le module**

Le corps reste celui d'`openRouterHealth` ; trois changements :

```typescript
export type Provider = 'openrouter' | 'deepgram'

const PROVIDER_LABELS: Record<Provider, string> = {
  openrouter: 'OpenRouter',
  deepgram: 'Deepgram',
}

const failurePath = (provider: Provider) =>
  `${STORE_KEYS.ADVANCED_SETTINGS}.providerFailures.${provider}`

function storedFailure(provider: Provider): ProviderFailure | undefined {
  const advanced = getAdvancedSettings() as any
  // Forme héritée : un seul objet, implicitement OpenRouter.
  if (provider === 'openrouter' && advanced?.openRouterFailure) {
    return advanced.providerFailures?.openrouter ?? advanced.openRouterFailure
  }
  return advanced?.providerFailures?.[provider]
}
```

Les libellés de `FAILURE_NOTICES` sont paramétrés par `PROVIDER_LABELS[provider]` au lieu de nommer OpenRouter en dur.

- [ ] **Step 4: Repointer les sept consommateurs**

| Fichier | Changement |
|---|---|
| `lib/main/store.ts` | `openRouterFailure` → `providerFailures?: Partial<Record<Provider, ProviderFailure>>`, l'ancien champ reste toléré en lecture |
| `lib/main/itoStreamController.ts` | `recordOpenRouterFallback` → `recordProviderFallback(error, model, apiKey, provider)` |
| `lib/window/ipcEvents.ts` | `get-openrouter-failure` → `get-provider-failure` avec un argument `provider` |
| `lib/preload/api.ts` | `getOpenRouterFailure()` → `getProviderFailure(provider)` |
| `app/index.d.ts` | Signature correspondante |
| `ModelsSettingsContent.tsx` | Trois appels, un par ligne de clé |
| `ProviderKeyRow.tsx` | Aucun changement — il reçoit déjà une `rejection` opaque |

- [ ] **Step 5: Lancer les tests et vérifier**

```bash
bun test --preload lib/__tests__/setup.ts lib/main/transcription/providerHealth.test.ts
bun test --preload lib/__tests__/setup.ts lib/main/itoStreamController.test.ts
bunx tsc --noEmit -p tsconfig.node.json
```
Expected: PASS, 0 erreur

- [ ] **Step 6: Commit**

```bash
git add lib/main/transcription/ lib/main/store.ts lib/main/itoStreamController.ts lib/window/ipcEvents.ts lib/preload/api.ts app/index.d.ts app/components/home/contents/settings/
git commit -m "refactor(health): provider failure records are per provider, not OpenRouter-only"
```

---

### Task 3.3ter : Semer le mode Meeting

**Files:**
- Modify: `lib/constants/modePresets.ts` (`SEEDED_PRESET_KEYS`)
- Modify: `lib/main/modes/modeSeeder.ts`
- Test: `lib/main/modes/modeSeeder.test.ts`

**Pourquoi ici et pas au lot 1 :** le preset Meeting nomme `nova-3`, routé chez OpenRouter dans le catalogue — pas de diarisation par cette voie et 10,6 % de WER. Il n'a de sens qu'une fois le chemin Deepgram en place, c'est-à-dire maintenant.

- [ ] **Step 1: Écrire le test qui échoue**

```typescript
  test('Meeting joins the seeded set once its engine exists', () => {
    expect(SEEDED_PRESET_KEYS).toEqual([
      'voice-to-text',
      'intelligent',
      'meeting',
      'message',
      'mail',
      'blank',
    ])
  })

  test('an install that already ran the first seed still gets Meeting', async () => {
    applied = ['2026-08-14-seed-modes']
    existing.push(
      ...['voice-to-text', 'intelligent', 'message', 'mail', 'blank'].map(id => ({
        id,
      })),
    )

    expect(await seedMeetingMode('self-hosted')).toBe(1)
    expect(mockInsert.mock.calls[0][0].id).toBe('meeting')
  })

  test('it does not come back after the user deletes it', async () => {
    applied = ['2026-08-14-seed-modes', '2026-08-14-seed-meeting']
    expect(await seedMeetingMode('self-hosted')).toBe(0)
    expect(mockInsert).not.toHaveBeenCalled()
  })
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `bun test --preload lib/__tests__/setup.ts lib/main/modes/modeSeeder.test.ts`
Expected: FAIL — `seedMeetingMode` n'existe pas

- [ ] **Step 3: Implémenter**

Ajouter `'meeting'` à `SEEDED_PRESET_KEYS` en troisième position, et dans `modeSeeder.ts` :

```typescript
const MEETING_SEED_ID = '2026-08-14-seed-meeting'

/**
 * Sème le mode Meeting, une fois seulement.
 *
 * Distinct de `seedModes` parce que les installations créées au lot 1 ont déjà
 * consommé son drapeau : sans un id propre, elles n'auraient jamais Meeting.
 */
export async function seedMeetingMode(userId: string): Promise<number> {
  if (hasRunOnce(MEETING_SEED_ID)) return 0

  const existing = await ModesTable.findAll(userId)
  if (existing.some(mode => mode.id === 'meeting')) {
    markRunOnce(MEETING_SEED_ID)
    return 0
  }

  const preset = findPreset('meeting')!
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
    sortOrder: existing.length,
  })

  markRunOnce(MEETING_SEED_ID)
  return 1
}
```

Appeler `seedMeetingMode(userId)` juste après `seedModes(userId)` dans `initializeStore`.

- [ ] **Step 4: Lancer le test et vérifier visuellement**

```bash
bun test --preload lib/__tests__/setup.ts lib/main/modes/modeSeeder.test.ts
bun dev
```
La page Modes montre six modes, Meeting inclus.

- [ ] **Step 5: Commit**

```bash
git add lib/constants/modePresets.ts lib/main/modes/
git commit -m "feat(modes): seed the Meeting mode now that its engine exists"
```

---

### Task 3.4 : Transcrire un fichier existant

**Files:**
- Create: `lib/main/transcription/fileTranscription.ts`
- Modify: `lib/window/ipcEvents.ts`
- Modify: `lib/preload/api.ts`, `app/index.d.ts`
- Modify: `app/components/home/contents/ModesContent.tsx` (bouton)
- Test: `lib/main/transcription/fileTranscription.test.ts`

**Interfaces:**
- Produces: `transcribeExistingFile(filePath: string, modeId?: string): Promise<{ ok: boolean; interactionId?: string; error?: string }>`

- [ ] **Step 1: Écrire le test qui échoue**

```typescript
// lib/main/transcription/fileTranscription.test.ts
import { describe, test, expect, mock, beforeEach } from 'bun:test'

const mockDeepgram = mock(async () => ({ text: 'transcript', segments: [] }))
mock.module('./DeepgramTranscriptionService', () => ({
  deepgramTranscriptionService: { transcribeAudio: mockDeepgram },
}))

const mockCreateRecovered = mock(async () => {})
mock.module('../interactions/InteractionManager', () => ({
  interactionManager: { createRecoveredInteraction: mockCreateRecovered },
}))

mock.module('../modes/activeMode', () => ({
  resolveMode: async () => ({
    id: 'meeting',
    name: 'Meeting',
    language: 'fr',
    identifySpeakers: true,
    useLlm: false,
    voiceModelKey: 'nova-3',
    textModelKey: null,
    instructions: '',
    contextApplication: false,
    contextClipboard: false,
    contextSelection: false,
  }),
  resolveActiveMode: async () => ({ id: 'meeting', name: 'Meeting' }),
}))

let fileBytes = Buffer.from('RIFF....WAVEfmt ')
mock.module('fs', () => ({
  default: {
    readFileSync: () => fileBytes,
    existsSync: () => true,
    statSync: () => ({ size: fileBytes.length }),
  },
  readFileSync: () => fileBytes,
  existsSync: () => true,
  statSync: () => ({ size: fileBytes.length }),
}))

mock.module('../store', () => ({
  getAdvancedSettings: () => ({ deepgramApiKey: 'dg-test' }),
  getCurrentUserId: () => 'self-hosted',
  default: { get: () => undefined, set: () => {} },
  store: { get: () => undefined, set: () => {} },
}))

const { transcribeExistingFile } = await import('./fileTranscription')

describe('transcribeExistingFile', () => {
  beforeEach(() => {
    mockDeepgram.mockClear()
    mockCreateRecovered.mockClear()
  })

  test('sends the file to Deepgram and stores the result in the history', async () => {
    const result = await transcribeExistingFile('C:/meeting.wav', 'meeting')

    expect(result.ok).toBe(true)
    expect(mockDeepgram).toHaveBeenCalledTimes(1)
    expect(mockCreateRecovered).toHaveBeenCalledTimes(1)
  })

  test('refuses without a Deepgram key rather than silently doing nothing', async () => {
    const store = await import('../store')
    ;(store.getAdvancedSettings as any) = () => ({ deepgramApiKey: '' })

    const result = await transcribeExistingFile('C:/meeting.wav', 'meeting')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Deepgram')
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `bun test --preload lib/__tests__/setup.ts lib/main/transcription/fileTranscription.test.ts`
Expected: FAIL — module absent

- [ ] **Step 3: Écrire `lib/main/transcription/fileTranscription.ts`**

```typescript
import fs from 'fs'
import { deepgramTranscriptionService } from './DeepgramTranscriptionService'
import { transcriptAdjuster } from './TranscriptAdjuster'
import { interactionManager } from '../interactions/InteractionManager'
import { resolveMode } from '../modes/activeMode'
import { getAdvancedSettings } from '../store'
import { asrLanguageHint } from '../../constants/modeLanguages'

const CONTENT_TYPES: Record<string, string> = {
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  mp4: 'video/mp4',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  webm: 'audio/webm',
}

function contentTypeFor(filePath: string): string {
  const extension = filePath.split('.').pop()?.toLowerCase() ?? ''
  return CONTENT_TYPES[extension] ?? 'audio/wav'
}

/**
 * Traite un enregistrement fait ailleurs (Teams, OBS, un dictaphone) avec un
 * mode existant.
 *
 * C'est le filet du mode Meeting : la première réunion qu'on veut résumer est
 * toujours celle qu'on a oublié de lancer dans Ito. Le fichier n'est pas
 * converti — Deepgram accepte les conteneurs courants tels quels, à condition
 * qu'on annonce le bon type MIME.
 */
export async function transcribeExistingFile(
  filePath: string,
  modeId?: string,
): Promise<{ ok: boolean; error?: string }> {
  const advancedSettings = getAdvancedSettings()
  const apiKey = advancedSettings.deepgramApiKey?.trim()

  if (!apiKey) {
    return {
      ok: false,
      error: 'Transcribing a file needs a Deepgram API key. Add one in Models.',
    }
  }

  if (!fs.existsSync(filePath)) {
    return { ok: false, error: 'File not found' }
  }

  const mode = await resolveMode(modeId)

  try {
    const audio = fs.readFileSync(filePath)
    const { text, segments } = await deepgramTranscriptionService.transcribeAudio(
      audio,
      {
        apiKey,
        model: 'nova-3',
        language: asrLanguageHint(mode.language),
        diarize: mode.identifySpeakers,
        // Deepgram accepte les conteneurs courants, mais il faut le lui dire :
        // annoncer audio/wav sur un .m4a ferait échouer le décodage.
        contentType: contentTypeFor(filePath),
      },
    )

    const finalText = mode.useLlm
      ? await transcriptAdjuster.adjust(
          text,
          mode,
          {
            vocabularyWords: [],
            dictionaryEntries: [],
            windowTitle: '',
            appName: '',
            contextText: '',
            clipboardText: '',
            advancedSettings,
          },
          advancedSettings,
        )
      : text

    await interactionManager.createRecoveredInteraction(
      finalText,
      16000,
      null,
      undefined,
      'deepgram/nova-3',
      { rawTranscript: text, modeId: mode.id, modeName: mode.name, speakers: segments },
    )

    console.log(`[fileTranscription] Transcribed ${filePath} in mode "${mode.name}"`)
    return { ok: true }
  } catch (error: any) {
    console.error('[fileTranscription] Failed:', error?.message || error)
    return { ok: false, error: error?.message || 'Transcription failed' }
  }
}
```

> `createRecoveredInteraction` gagne un sixième paramètre optionnel `extra?: { rawTranscript?; modeId?; modeName?; speakers? }`, fusionné dans `asr_output`.

- [ ] **Step 4: Exposer le canal et le bouton**

Dans `lib/window/ipcEvents.ts` :

```typescript
  handleIPC('transcribe-file', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Transcribe a recording',
      properties: ['openFile'],
      filters: [
        {
          name: 'Audio and video',
          extensions: ['wav', 'mp3', 'm4a', 'mp4', 'ogg', 'flac', 'webm'],
        },
      ],
    })
    if (canceled || !filePaths[0]) return { ok: false }

    const { transcribeExistingFile } = await import(
      '../main/transcription/fileTranscription'
    )
    return transcribeExistingFile(filePaths[0])
  })
```

Dans `lib/preload/api.ts` : `transcribeFile: () => ipcRenderer.invoke('transcribe-file')`, déclaré dans `IpcApi`.

Dans `ModesContent.tsx`, à côté de « Create mode » :

```tsx
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            const result = await window.api.transcribeFile()
            if (result.error) setFileError(result.error)
          }}
        >
          Transcribe a file
        </Button>
```

avec `const [fileError, setFileError] = useState('')` et un `SettingsNote tone="error"` sous l'en-tête quand il est renseigné.

- [ ] **Step 5: Lancer les tests et vérifier**

```bash
bun test --preload lib/__tests__/setup.ts lib/main/transcription/fileTranscription.test.ts
bunx tsc --noEmit -p tsconfig.node.json
```
Expected: PASS, 0 erreur

- [ ] **Step 6: Vérification manuelle avec un vrai fichier**

Run: `bun dev`

1. Modes → « Transcribe a file » → choisir `.wayfinder/assets/015-bakeoff/enregistrement-feature-ito.m4a` (149 s). C'est aussi le test que Deepgram accepte bien un conteneur autre que WAV.
2. L'historique reçoit une ligne avec le nom du mode actif.
3. Rendre le mode actif « Meeting » et recommencer → la ligne porte des segments de locuteurs.

- [ ] **Step 7: Commit**

```bash
git add lib/main/transcription/fileTranscription.ts lib/main/transcription/fileTranscription.test.ts lib/window/ipcEvents.ts lib/preload/api.ts app/index.d.ts app/components/home/contents/ModesContent.tsx lib/main/interactions/InteractionManager.ts
git commit -m "feat(transcription): transcribe an existing recording with the active mode"
```

---

## Vérification du lot 3

```bash
for f in \
  lib/main/deepgramKey.test.ts \
  lib/main/transcription/DeepgramTranscriptionService.test.ts \
  lib/main/transcription/transcriptionRouter.test.ts \
  lib/main/transcription/fileTranscription.test.ts \
  lib/main/transcription/LocalAudioProcessor.test.ts \
  lib/main/itoStreamController.test.ts ; do
  echo "--- $f"; bun test --preload lib/__tests__/setup.ts "$f" 2>&1 | tail -4
done
```

**Critère de sortie :** une dictée de plus de 15 minutes se transcrit sans erreur, et un fichier de réunion existant produit une ligne d'historique.
