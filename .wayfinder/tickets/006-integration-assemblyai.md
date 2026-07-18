---
id: 006
title: "Optimisation Groq : appliquer tous les leviers d'exactitude et de latence"
label: wayfinder:task
mode: AFK
status: open
assignee:
blocked-by: [001, 004]
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
