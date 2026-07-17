---
id: 007
title: "Fiabilité : ne jamais perdre une dictée"
label: wayfinder:task
mode: AFK
status: open
assignee:
blocked-by: [001, 004]
---

## Question

Décision de cadrage (2026-07-17) : une dictée ne doit **jamais** être perdue. Aujourd'hui, un échec réseau/API = transcript perdu, audio jamais persisté, zéro retry (`itoSessionManager.ts:105,146-155`).

À implémenter : persistance locale temporaire de l'audio jusqu'à transcription réussie (suppression après succès), retries avec backoff, file d'attente hors-ligne, notification visible en échec définitif avec possibilité de rejouer la transcription. Traiter aussi la troncature silencieuse du drain timeout (`lib/media/audio.ts:266-273`).

Le design dépend de l'architecture ([Décision streaming ou batch](004-decision-streaming-ou-batch.md)) : en streaming, définir ce qu'on persiste (frames envoyées + transcript partiel) et le fallback batch sur coupure en cours de stream. Approche /tdd recommandée.
