# Refonte du système de Modes — Plan directeur

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformer les deux modes câblés en dur d'Ito (`TRANSCRIBE`/`EDIT`) en une collection de modes créés par l'utilisateur — chacun portant ses instructions, ses contextes, sa langue, ses modèles, son raccourci et ses réglages de capture — visibles dans une page dédiée de la sidebar, sur le modèle de Superwhisper.

**Architecture:** Un mode devient une ligne SQLite (`modes`) avec ses exemples (`mode_examples`). Le pipeline de dictée résout un mode au démarrage de la session et le porte de bout en bout : le mode décide du modèle vocal, du passage LLM, des contextes injectés, de la source audio et de l'insertion. Les six modes semés proviennent d'un catalogue de presets en dur (`lib/constants/modePresets.ts`), copiés à la création. Trois chemins de transcription coexistent : Groq (multipart, court), OpenRouter (base64 JSON, moyen), Deepgram (multipart fichier, long + diarisation), choisis automatiquement par le couple (modèle du mode, durée).

**Tech Stack:** TypeScript, Electron 37, React 19, zustand, SQLite (via le repo maison `lib/main/sqlite`), Rust + cpal 0.16 (`native/audio-recorder`), bun test.

---

## Global Constraints

Ces contraintes s'appliquent à **toutes** les tâches de tous les lots. Elles proviennent d'une session `/grilling` de 4 tours, 27 questions, toutes tranchées explicitement par Caleb le 2026-08-14.

- **Langue du code et de l'UI : anglais.** Les commentaires de code peuvent être en français (le dépôt en contient déjà) ; les libellés d'interface sont en anglais. Les notifications système sont en français (convention existante).
- **Charte visuelle monochrome.** Blanc sur near-black, police Geist, fenêtre fixe 900×620. Deux teintes seulement sont autorisées : `--destructive` et `--positive`, uniquement en pastille de 6 px, jamais en aplat, jamais sur du texte. Ne jamais réintroduire de vermillon.
- **`console.log` / `console.warn` / `console.error`**, jamais `log.info` (règle du CLAUDE.md). Les `log.*` existants ne sont pas à convertir, mais aucun nouveau.
- **Tests un fichier à la fois** : `bun test --preload lib/__tests__/setup.ts <fichier>`. Un run groupé sur un dossier partage un process et les `mock.module` fuient d'un fichier à l'autre — cela produit ~26 faux échecs. Ne jamais juger la suite sur un run groupé.
- **`bun runAppTests` / `runLibTests` ne tournent pas sous Windows** (les scripts utilisent `xargs`).
- **Deux erreurs `tsc` préexistantes par famille** (`IpcApi` incomplet côté web, `React` non utilisé dans de vieux fichiers d'icônes). Filtrer avant de conclure. Référence au démarrage de ce plan : `bunx tsc --noEmit -p tsconfig.node.json` → **0 erreur** ; `bunx tsc --noEmit -p tsconfig.web.json` → **136 erreurs**. Aucune tâche ne doit augmenter ces nombres.
- **Toute nouvelle méthode exposée au renderer doit être déclarée dans `app/index.d.ts` (`interface IpcApi`)**, sinon elle ajoute une erreur `tsc` web.
- **Le catalogue de modèles est mesuré, pas documenté.** Aucun chiffre de `lib/constants/modelCatalog.ts` ne vient d'un fournisseur. Ne jamais les « corriger » depuis une documentation. `whisper-large-v3` est cassé au-delà de 40 s (82,9 % de WER) — ne jamais le proposer par défaut.
- **Ordre des migrations `lib/main/store.ts`** : toute nouvelle migration se place **après** `2026-08-14-model-catalog-keys`.
- **Ne pas réinstaller `@dicebear/styles`** (désinstallé volontairement, définition vendue dans `app/assets/dicebear-blobs.json`).
- **Commits fréquents**, un par tâche minimum, message conventionnel (`feat:`, `fix:`, `refactor:`, `test:`).

---

## Décisions verrouillées

À ne pas rouvrir sans instruction explicite de Caleb.

| # | Décision |
|---|---|
| D1 | Un mode possède : instructions, contextes, langue, modèle vocal, modèle texte, raccourci, réglages d'insertion et de capture. **Il ne possède pas** de liste d'apps d'activation (« Activate for apps » de Superwhisper est hors périmètre). |
| D2 | Les modèles sont **par mode**, pas globaux. |
| D3 | Activation : **un mode actif** global + des **raccourcis dédiés** optionnels par mode qui court-circuitent le mode actif le temps d'une dictée. |
| D4 | Six modes semés : `voice-to-text`, `intelligent`, `meeting`, `message`, `mail`, `blank`. **`meeting` est semé au lot 3**, pas au lot 1 : son modèle vocal n'a de chemin viable qu'une fois Deepgram en place. |
| D5 | Le preset est un **sélecteur permanent** : en changer **écrase** les instructions (confirmation si éditées) ; le libellé bascule sur `Custom` dès édition. |
| D6 | Les exemples few-shot sont dans la V1, **avec** le bouton « Add as example » depuis l'historique. |
| D7 | **Modes** et **Models** deviennent des entrées de la sidebar principale. |
| D8 | Le transcript brut est persisté à côté du transcript final. |
| D9 | Le plafond des 13 min saute via un **chemin fichier Deepgram** — **troisième clé API assumée**. |
| D10 | Capture système **Windows uniquement**, sources : micro / système / **les deux mixés**. |
| D11 | Les trois contextes : Application (titre de fenêtre + nom d'app **seulement**, pas le contenu), Copied text, Selected text (garde-fou terminaux Windows conservé). |
| D12 | Advanced ne garde que seuil de silence, service grammaire, contexte accessibilité. **`transcriptionPrompt` est supprimé** (champ mort). |
| D13 | Auto-paste Off → presse-papier + notification. **Aucune nouvelle fenêtre.** |
| D14 | Migration : `mode: 0` → `voice-to-text`, `mode: 1` → `intelligent`. `ItoMode` reste dans le proto mais disparaît du code interne. |
| D15 | Diarisation complète : segments horodatés, vue Speakers, renommage en lot, bouton Copy. |
| D16 | Le mode possède **un** modèle vocal ; le chemin fichier se déclenche **automatiquement sur la durée**, sans réglage exposé. Le seuil court/long global disparaît. |
| D17 | La page Models devient **catalogue + clés + défauts**. Plus de sélection Short/Long. |
| D18 | Settings → Keyboard garde les globaux et **liste en lecture seule** les raccourcis de modes avec **détection de conflit**. |
| D19 | Langue : `Français` (défaut), `Anglais`, `Espagnol`, `Automatique` (**en dernier**, il dégrade la précision). Elle impose la langue de sortie LLM **sauf** en Automatique. |
| D20 | Exemples injectés en **faux tours de conversation** ; contextes dans le **message utilisateur** ; dictée en dernier. Banc de mesure **plus tard**, quand 10 dictées réelles existeront. |
| D21 | Instructions semées en anglais, structure `## Role` / `## Instructions` / `## Critical` **visible et éditable**. |
| D22 | Les modes vivent en **SQLite**, pas dans le JSON de réglages. |
| D23 | `Transcribe File…` est dans la V1. |

---

## Modèle de données

### Table `modes`

```sql
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
```

Notes de conception :

- **`id` des modes semés est lisible et stable** (`'voice-to-text'`, `'intelligent'`, `'meeting'`, `'message'`, `'mail'`, `'blank'`). Les modes créés par l'utilisateur reçoivent un `uuidv4()`. Cela rend la migration des raccourcis (D14) déterministe sans lookup.
- **`voice_model_key` / `text_model_key` à `NULL`** signifient « le défaut du catalogue ». Un mode semé porte une valeur explicite ; un mode créé depuis `blank` porte `NULL`.
- **`preset`** vaut l'une des six clés de preset ou `'custom'`. Il n'est qu'un libellé après création (D5).
- **`asr_prompt`** est l'amorce de style Whisper, déplacée du global vers le mode (D12).
- SQLite n'a pas de booléen : `INTEGER` 0/1, converti en `boolean` par le repo.

### Table `mode_examples`

```sql
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
```

### Réglages touchés

| Clé | Avant | Après |
|---|---|---|
| `settings.activeModeId` | — | **nouveau**, id du mode actif |
| `settings.cycleModeShortcut` | — | **nouveau**, défaut `Ctrl+Shift+M` |
| `settings.keyboardShortcuts[].mode` | `ItoMode` (0/1) | **supprimé** |
| `settings.keyboardShortcuts[].modeId` | — | **nouveau**, `string` |
| `advancedSettings.shortVoiceModelKey` | clé catalogue | **supprimé** (lot 1) |
| `advancedSettings.longVoiceModelKey` | clé catalogue | **supprimé** (lot 1) |
| `advancedSettings.textModelKey` | clé catalogue | **conservé** comme *défaut* des nouveaux modes |
| `advancedSettings.longDictationEnabled` | bool | **supprimé** (lot 1) |
| `advancedSettings.longDictationThresholdMs` | number | **supprimé** (lot 1) |
| `advancedSettings.llm.editingPrompt` | prompt global | **supprimé**, migré dans le mode `intelligent` |
| `advancedSettings.llm.transcriptionPrompt` | prompt mort | **supprimé** (D12) |
| `advancedSettings.llm.asrPrompt` | amorce globale | **supprimé**, migré dans tous les modes semés |
| `advancedSettings.llm.asrLanguage` | `'fr'` | **supprimé**, migré en `modes.language` |
| `advancedSettings.deepgramApiKey` | — | **nouveau** (lot 3), chiffré comme les deux autres |
| `settings.muteAudioWhenDictating` | bool global | **conservé** comme défaut, surchargé par `modes.playback_when_recording` |
| `advancedSettings.openRouterFailure` | objet unique | **remplacé** (lot 3) par `providerFailures`, une map par fournisseur ; l'ancien champ reste lu |
| `appliedMigrations` | ids de migrations | **réutilisé** pour les drapeaux « déjà fait » des semis et migrations de modes |

> **Ne jamais créer de clé top-level pour un drapeau.** `initializeStore()` ne recharge qu'une liste blanche fermée (`lib/main/store.ts:537-550`) : une clé hors de cette liste est écrite en base et jamais relue, donc `undefined` à chaque démarrage. Une migration protégée par un tel drapeau se rejouerait à chaque lancement. `appliedMigrations` est dans la liste et porte déjà cette sémantique — c'est le seul mécanisme autorisé ici.

### Structure `asr_output` de l'historique

```jsonc
{
  "transcript": "…",          // texte final inséré (après LLM)
  "rawTranscript": "…",       // NOUVEAU (lot 2) — sortie brute du moteur vocal
  "modeId": "intelligent",    // NOUVEAU (lot 1)
  "modeName": "Intelligent",  // NOUVEAU (lot 1) — figé, survit à un renommage
  "engine": "qwen/qwen3-asr-flash-2026-02-10",
  "fallback": { "from": "…", "code": "…", "message": "…" } | null,
  "speakers": [               // NOUVEAU (lot 5)
    { "speaker": 0, "label": "Speaker 1", "startMs": 0, "endMs": 9000, "text": "…" }
  ],
  "totalAudioBytes": 0,
  "error": null,
  "errorCode": null,
  "timestamp": "…",
  "durationMs": 82058,
  "interactionDurationMs": 102420
}
```

---

## Cartographie des fichiers

### Créés

| Fichier | Responsabilité |
|---|---|
| `lib/constants/modePresets.ts` | Les six presets en dur : libellé, icône, instructions, langue, modèles, contextes, réglages de capture. Aucune logique. |
| `lib/constants/modeLanguages.ts` | Les quatre langues (`fr`, `en`, `es`, `auto`) avec drapeau et libellé, dans l'ordre d'affichage. |
| `lib/main/modes/ModeRepository.ts` | CRUD SQLite des modes et de leurs exemples. Convertit 0/1 ↔ booléen. |
| `lib/main/modes/modeSeeder.ts` | Sème les six modes au premier lancement, idempotent. |
| `lib/main/modes/activeMode.ts` | Lecture/écriture du mode actif, résolution `modeId → Mode`, défilement. |
| `lib/main/modes/promptBuilder.ts` | Assemble le prompt : système (instructions), exemples en faux tours, contextes + dictée en message utilisateur. |
| `lib/main/context/ClipboardContext.ts` | Lecture du presse-papier pour le contexte `Copied text`. |
| `lib/main/transcription/DeepgramTranscriptionService.ts` | Chemin fichier multipart : longs enregistrements + diarisation. |
| `lib/main/transcription/transcriptionRouter.ts` | Choisit le chemin (Groq / OpenRouter / Deepgram) à partir du mode et de la durée. |
| `lib/main/audio/audioSourceController.ts` | Traduit `modes.audio_source` en commandes au binaire Rust. |
| `app/store/useModesStore.ts` | État renderer des modes (liste, mode actif, CRUD, exemples). |
| `app/components/home/contents/ModesContent.tsx` | Liste des modes + bouton « Create mode ». |
| `app/components/home/contents/modes/ModeEditor.tsx` | Écran d'édition d'un mode. |
| `app/components/home/contents/modes/ModeRow.tsx` | Une ligne de la liste (icône, nom, pastille active, raccourci). |
| `app/components/home/contents/modes/PresetSelect.tsx` | Sélecteur de preset avec confirmation d'écrasement. |
| `app/components/home/contents/modes/LanguageSelect.tsx` | Sélecteur de langue à drapeaux. |
| `app/components/home/contents/modes/ExamplesEditor.tsx` | Liste éditable des paires exemple. |
| `app/components/home/contents/modes/ContextToggles.tsx` | Les trois cases de contexte. |
| `app/components/home/contents/history/SpeakersView.tsx` | Vue Speakers + renommage + Copy. |

### Modifiés

| Fichier | Changement |
|---|---|
| `lib/main/sqlite/migrations.ts` | + 2 migrations (tables `modes`, `mode_examples`) |
| `lib/main/sqlite/models.ts` | + `Mode`, `ModeExample`, `ModeLanguage`, `AudioSource` |
| `lib/main/sqlite/repo.ts` | + `ModesTable`, `ModeExamplesTable` |
| `lib/main/store.ts` | `AdvancedSettings` élagué, + `activeModeId`, + migrations de réglages |
| `lib/main/itoSessionManager.ts` | `startSession(modeId)`, porte le mode |
| `lib/main/itoStreamController.ts` | Résout le mode, remplace `shouldUseOpenRouter` par le routeur |
| `lib/main/transcription/TranscriptAdjuster.ts` | Prend un `Mode`, délègue à `promptBuilder` |
| `lib/main/context/ContextGrabber.ts` | Prend un `Mode`, applique les trois toggles |
| `lib/main/recordingStateNotifier.ts` | Envoie `modeId`/`modeName`/`modeIcon` |
| `lib/main/interactions/InteractionManager.ts` | Persiste `rawTranscript`, `modeId`, `modeName`, `speakers` |
| `lib/main/voiceInputService.ts` | `playback_when_recording` par mode |
| `lib/media/keyboard.ts` | `shortcut.modeId`, résolution du mode actif |
| `lib/window/ipcEvents.ts` | + canaux `modes:*` |
| `lib/preload/api.ts` | + `modes` |
| `app/index.d.ts` | + `modes` dans `IpcApi` |
| `app/store/useSettingsStore.ts` | `modeId` au lieu de `mode` |
| `app/store/useMainStore.ts` | + pages `modes` / `models` |
| `app/components/home/HomeShell.tsx` | + entrées de nav |
| `app/components/home/HomeKit.tsx` | + routes |
| `app/components/home/contents/SettingsContent.tsx` | − onglet Models |
| `app/components/home/contents/settings/ModelsSettingsContent.tsx` | Devient catalogue + clés + défauts |
| `app/components/home/contents/settings/AdvancedSettingsContent.tsx` | Élagué |
| `app/components/home/contents/settings/KeyboardSettingsContent.tsx` | + liste des raccourcis de modes + conflits |
| `app/components/home/contents/HomeContent.tsx` | + badge de mode, bascule Original/IA, « Add as example » |
| `app/components/pill/Pill.tsx` | Affiche le nom du mode |
| `native/audio-recorder/src/main.rs` | Loopback WASAPI + mixage |

### Supprimés

| Fichier | Raison |
|---|---|
| `lib/constants/transcription.ts` → `LONG_DICTATION_THRESHOLD_MS`, `LONG_DICTATION_THRESHOLD_OPTIONS` | Le seuil court/long disparaît (D16). `UNRECOVERABLE_CODES` reste. |
| `app/components/home/contents/settings/models/ModelTable.tsx` → colonnes de slots | Remplacé par un tableau de référence sans sélection (D17). |

---

## Les cinq lots

| Lot | Fichier | Dépend de | Livrable |
|---|---|---|---|
| 1 — Visibilité | [`…-lot1-visibilite.md`](2026-08-14-modes-lot1-visibilite.md) | — | Les modes existent comme entités, sont visibles et pilotent le pipeline |
| 2 — Le cerveau | [`…-lot2-cerveau.md`](2026-08-14-modes-lot2-cerveau.md) | 1 | Prompt structuré, 3 contextes, exemples, transcript brut |
| 3 — Format long | [`…-lot3-format-long.md`](2026-08-14-modes-lot3-format-long.md) | 1 | Chemin Deepgram, plafond des 13 min levé, `Transcribe File…` |
| 4 — Capture système | [`…-lot4-capture-systeme.md`](2026-08-14-modes-lot4-capture-systeme.md) | 1, 3 | Enregistrement de Meet/Teams depuis Ito |
| 5 — Diarisation | [`…-lot5-diarisation.md`](2026-08-14-modes-lot5-diarisation.md) | 3 | Vue Speakers, renommage, Copy |

**Ordre d'exécution : 1 → 2 → 3 → 4 → 5.**

**Précondition commune :** le commit `feat(transcription): name the reason a long dictation fell back to Groq` doit être en place. Plusieurs ancres de ligne des lots 1 à 3 le supposent (`lib/preload/api.ts` après `getOpenRouterFailure`, la signature `createInteraction(..., asr?)`, `withRetry` dans `itoStreamController`, le module `openRouterHealth`).

Dépendances dures : le lot 5 exige le lot 3 (c'est Deepgram qui rend la diarisation) ; le lot 4 sans le lot 3 produit un enregistrement de réunion intranscriptible au-delà de 13 minutes.

---

## Risques identifiés

| Risque | Mitigation |
|---|---|
| La migration des raccourcis casse le déclenchement de la dictée — symptôme le plus grave possible (l'app ne réagit plus). | Tâche 1.6 dédiée, avec un test qui part du JSON exact du store de Caleb (`mode: 0` / `mode: 1`) et vérifie les `modeId` obtenus. |
| `muteAudioWhenDictating` coupe l'audio que le mode Meeting enregistre. | `playback_when_recording` par mode, forcé à `leave` dans le preset Meeting (tâche 4.3), avec un test. |
| Le mixage micro + loopback dérive (deux horloges matérielles distinctes). | Rééchantillonnage vers 16 kHz avec compensation par comptage d'échantillons, tâche 4.2, plus un test Rust sur 60 s simulées. |
| La 3ᵉ clé (Deepgram) absente rend le mode Meeting muet sans explication. | Le routeur (tâche 3.2) refuse le chemin fichier sans clé et remonte `MISSING_API_KEY`, capturé par `openRouterHealth` généralisé en `providerHealth`. |
| La suppression de `shortVoiceModelKey`/`longVoiceModelKey` perd le réglage mesuré de Caleb. | Migration 1.5 : `shortVoiceModelKey` → modèle du mode `voice-to-text`, `longVoiceModelKey` → modèle du mode `intelligent`. Test dédié. |
| 6 modes × 1 raccourci = collisions silencieuses. | Détection de conflit (tâche 1.9) affichée dans Settings → Keyboard **et** dans l'éditeur de mode. |
| Une migration protégée par un drapeau non rechargé se rejoue à chaque démarrage et écrase les modes. | Tous les drapeaux passent par `appliedMigrations` ; test dédié qui vérifie que le drapeau y atterrit (tâches 1.4, 1.5, 1.6). |
| Le mode Meeting réutilise silencieusement le flux micro préparé au démarrage. | La source entre dans la clé de cache du fast-path Rust (tâche 4.1), avec un test unitaire sur `can_reuse_stream`. |
| Le contexte presse-papier relit la dictée précédente d'Ito et se résume lui-même. | `rememberInsertedText` + garde d'égalité dans `readClipboardText` (tâche 2.3). |
| **Régression de qualité assumée entre ~40 s et ~3 min.** Le routage automatique à 60 s vers le moteur précis disparaît (D16) ; une dictée d'une à trois minutes en mode Voice to text ou Message reste sur Whisper turbo, dont les hallucinations démarrent vers une minute. | **Aucune** — décision explicite de Caleb, prise en connaissance du chiffre : une dictée longue se fait dans un mode dont le modèle est précis. Ne pas réintroduire de bascule cachée. |

---

## Vérification finale (après le lot 5)

```bash
bunx tsc --noEmit -p tsconfig.node.json        # attendu : 0 erreur
bunx tsc --noEmit -p tsconfig.web.json 2>&1 | grep -c "error TS"   # attendu : <= 136
bunx eslint lib/ app/                          # attendu : silence
bunx prettier --check lib/ app/                # attendu : "All matched files use Prettier code style"
cd native && cargo test --workspace && cargo clippy --workspace -- -D warnings
bunx electron-vite build                       # attendu : build complet
```
