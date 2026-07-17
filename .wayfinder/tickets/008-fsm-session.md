---
id: 008
title: "Stabilité : machine à états de session explicite"
label: wayfinder:task
mode: AFK
status: closed
assignee: claude (session du 2026-07-18)
blocked-by: [001]
resolved: 2026-07-18
---

## Question

L'état de session est implicite et éparpillé (`activeShortcutId` dans `lib/media/keyboard.ts:31` + `AudioStreamManager.isStreaming`), sans FSM ni garde de ré-entrance : `completeSession`/`cancelSession` lancés sans `await` (`keyboard.ts:249,189`), un press/release rapide peut entrelacer start et complete, un échec d'`initialize` laisse l'UI et l'état réel divergents (`itoSessionManager.ts:39-42`).

À implémenter : machine à états explicite (idle → recording → processing → inserting → idle) avec transitions gardées, rendant ces races impossibles ; c'est vraisemblablement une cause majeure de l'instabilité perçue. Résolu = FSM testée (`bun runLibTests`), press/release rapides et déclenchements concurrents pill+raccourci sans divergence d'état. Approche /tdd recommandée.

## Résolution (2026-07-18, commit `22a0392`)

FSM explicite `idle → starting → recording → processing → idle` implémentée **dans `ItoSessionManager`** — le point d'étranglement où convergent les deux points d'entrée (handler clavier et IPC pill), ce qui rend les appels non-`await`és des appelants sûrs sans les modifier :

- `startSession` refusé hors `idle` (double-démarrage impossible ; le deuxième appel retourne `null`).
- `completeSession` **attend le start en vol** (`startPromise`) avant de décider — le press/release ultra-rapide ne peut plus entrelacer start et complete ; refusé hors `recording`.
- Échec d'`initialize` → retour à `idle` + `notifyRecordingStopped()` (l'UI ne reste plus désynchronisée) ; la session suivante repart normalement.
- `cancelSession` reste valide depuis n'importe quel état (reset forcé, échappatoire de récupération — préserve le comportement attendu par les tests existants) ; un cancel pendant `processing` fait **jeter le transcript tardif** au lieu de l'insérer dans l'app.
- `setMode` ignoré hors `starting`/`recording`.

6 nouveaux tests de races (double start, complete à froid, complete pendant start lent, start échoué puis relance, cancel pendant processing, setMode à froid) — suite lib complète verte, type-check et lint verts. Non traité ici (noté au brouillard de la carte) : la troncature silencieuse du drain timeout, qui appartient au ticket [Fiabilité](007-fiabilite-jamais-perdre-dictee.md).
