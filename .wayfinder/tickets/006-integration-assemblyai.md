---
id: 006
title: "Optimisation Groq : appliquer tous les leviers d'exactitude et de latence"
label: wayfinder:task
mode: AFK
status: closed
assignee: claude (session du 2026-07-18)
blocked-by: [001, 004]
resolved: 2026-07-18
---

## Question

*(Recentré le 2026-07-18 par la [décision de routage](004-decision-streaming-ou-batch.md) : Groq seul, AssemblyAI hors périmètre.)*

Appliquer à `LocalTranscriptionService` (et autour) les leviers identifiés par la [recherche Groq](010-recherche-groq-optimisation.md) :

1. **`language: 'fr'` par défaut** dans l'appel ASR, exposé en réglage dans Advanced Settings (valeur vide = auto-détection) — décision 004.
2. **Prompt retravaillé** : écrit en français ponctué et accentué, intégrant le dictionnaire utilisateur (le style/langue du prompt tire la sortie ; les 224 tokens servent au vocabulaire, pas aux instructions).
3. **`temperature: 0` explicite** sur l'appel ASR.
4. **Filtrage anti-hallucination par segment** : exploiter `no_speech_prob`/`avg_logprob`/`compression_ratio` du `verbose_json` sur **tous** les segments (aujourd'hui seul le premier est vérifié) — seuils de départ : no_speech 0,6, à ajuster.
5. **Garde-fou durée/VAD** : ne pas envoyer de buffer sans parole utile (~<1 s) ; trim raisonnable des silences sans toucher aux pauses courtes qui portent la ponctuation.
6. **Erreurs typées** : remplacer le string-sniffing des messages Groq (`LocalTranscriptionService.ts:162-180`) par un mapping sur les codes HTTP/`retry-after` du SDK.
7. **Modèle en config, pas en dur** (précédent de dépréciation Groq à 2 mois de préavis) ; garder `whisper-large-v3` (pas turbo).
8. **Conserver** le prétraitement audio actuel (DC-offset/high-pass/normalisation) — ne pas ajouter de débruitage.

Résolu = dictée FR/EN de bout en bout mesurablement plus exacte sur la machine de Caleb, tests `bun runLibTests` verts, type-check/lint verts. Le backoff `retry-after`/retries appartient au ticket [Fiabilité](007-fiabilite-jamais-perdre-dictee.md).

## Résolution (2026-07-18, commit `02a7fe1`)

Les 8 leviers appliqués :
1. **`language`** : nouveau réglage `asrLanguage` (défaut `'fr'`, vide = auto-détection), passé à l'appel Whisper, exposé dans Advanced Settings, rempli automatiquement pour les stores existants via `ensureDefaultsDeep`, préservé par la sync serveur (champ absent du proto → valeur locale conservée). Le générateur `scripts/generate-constants.js` (template codé en dur qui ignorait silencieusement les nouveaux champs) a été mis à jour.
2. **Prompt** : base française ponctuée/accentuée par défaut (« Voici une dictée en français… termes techniques anglais ») + dictionnaire en « Vocabulaire : … », plafond 224 tokens conservé. Au passage, le réglage `asrPrompt` de l'UI — **mort dans le pipeline local** (jamais transmis) — est ravivé comme override du prompt de base.
3. **`temperature: 0`** explicite sur l'appel ASR.
4. **Filtrage anti-hallucination multi-segments** : tous les segments du `verbose_json` sont examinés (avant : le premier seulement) — tout-silence → `NO_SPEECH` ; segment individuel halluciné (`no_speech_prob` > seuil ET `avg_logprob` < −0,5) → retiré du texte.
5. **Garde silence** : RMS+peak sur le PCM **brut** (avant normalisation, ~−50 dBFS conservateur) dans `prepareAudioForTranscription` — un clip silencieux ne part plus jamais en réseau.
6. **Erreurs typées** : mapping sur `status` HTTP du SDK (401→INVALID_API_KEY, 429→`RATE_LIMIT` avec `retryAfterMs` extrait de `retry-after`, 5xx/connexion→NETWORK), sniffing de message en fallback seulement. `LocalTranscriptionError` porte `status`/`retryAfterMs` pour la couche retry du ticket 007.
7. **Modèle** : reste en config (`asrModel`), `whisper-large-v3` conservé.
8. **Prétraitement** : inchangé, aucun débruitage ajouté.

21 nouveaux tests (prompt, filtrage segments, mapping d'erreurs via groq-sdk mocké, garde silence). Suite lib 26 fichiers 0 échec, type-check et lint verts. **Validation d'exactitude réelle** (dictées de Caleb avant/après) : ticket [Validation finale](009-validation-finale.md).
