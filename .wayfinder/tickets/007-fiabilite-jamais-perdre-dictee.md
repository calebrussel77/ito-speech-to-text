---
id: 007
title: "Fiabilité : ne jamais perdre une dictée"
label: wayfinder:task
mode: AFK
status: closed
assignee: claude (session du 2026-07-18)
blocked-by: [001, 004]
resolved: 2026-07-18
---

## Question

Décision de cadrage (2026-07-17) : une dictée ne doit **jamais** être perdue. Aujourd'hui, un échec réseau/API = transcript perdu, audio jamais persisté, zéro retry (`itoSessionManager.ts:105,146-155`).

À implémenter : persistance locale temporaire de l'audio jusqu'à transcription réussie (suppression après succès), retries avec backoff, file d'attente hors-ligne, notification visible en échec définitif avec possibilité de rejouer la transcription. Traiter aussi la troncature silencieuse du drain timeout (`lib/media/audio.ts:266-273`).

*(Mise à jour 2026-07-18 : la [décision de routage](004-decision-streaming-ou-batch.md) a retenu Groq seul en batch — le design se simplifie : persister le WAV/PCM du clip jusqu'à succès, pas de cas streaming.)* Inclure le backoff sur `retry-after`/headers `x-ratelimit-*` de Groq pour les retries. Approche /tdd recommandée.

## Résolution (2026-07-18, commit `d9bc9f3`)

- **Persistance** : nouveau `PendingDictationStore` — le WAV est écrit dans `userData/pending-dictations/` **avant** l'appel réseau et supprimé après succès. Panne réseau, API down ou crash de l'app : l'audio survit sur disque. Nommage à compteur monotone (ordre de récupération déterministe).
- **Retries** : 3 tentatives avec backoff exponentiel (500 ms × 2ⁿ), en honorant le `retryAfterMs` extrait du `retry-after` Groq (posé au ticket 006). Seuls `RATE_LIMIT` et `NETWORK` sont retentés ; les erreurs fatales (clé invalide…) échouent immédiatement.
- **Échec définitif** : notification système visible (« dictée sauvegardée »), fichier conservé. Les cas irrécupérables (`NO_SPEECH`, `AUDIO_TOO_SHORT`) suppriment le fichier — rien à récupérer d'un silence.
- **Récupération automatique** : au démarrage de l'app (délai 10 s) et 5 s après chaque dictée réussie (réseau manifestement revenu), les fichiers en attente sont transcrits et stockés dans **l'historique d'interactions** via `createRecoveredInteraction` (id propre, ne touche pas la session courante) + notification. Pas de réinsertion au curseur : le contexte d'origine n'existe plus. Une dictée live interrompt la récupération (priorité au direct).
- **Drain timeout** : log d'avertissement de troncature (`audio.ts`) au lieu du silence — la vraie correction du drain reste au brouillard si les mesures la justifient.

9 nouveaux tests (cycle persistance, retry transitoire vs fatal, drop des irrécupérables, flush de récupération, arrêt sur échec transitoire, roundtrip du store). Suite lib 28 fichiers 0 échec, type-check/lint verts. Validation réelle (coupure réseau en pleine dictée) : ticket [Validation finale](009-validation-finale.md).
