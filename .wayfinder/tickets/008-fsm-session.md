---
id: 008
title: "Stabilité : machine à états de session explicite"
label: wayfinder:task
mode: AFK
status: open
assignee:
blocked-by: [001]
---

## Question

L'état de session est implicite et éparpillé (`activeShortcutId` dans `lib/media/keyboard.ts:31` + `AudioStreamManager.isStreaming`), sans FSM ni garde de ré-entrance : `completeSession`/`cancelSession` lancés sans `await` (`keyboard.ts:249,189`), un press/release rapide peut entrelacer start et complete, un échec d'`initialize` laisse l'UI et l'état réel divergents (`itoSessionManager.ts:39-42`).

À implémenter : machine à états explicite (idle → recording → processing → inserting → idle) avec transitions gardées, rendant ces races impossibles ; c'est vraisemblablement une cause majeure de l'instabilité perçue. Résolu = FSM testée (`bun runLibTests`), press/release rapides et déclenchements concurrents pill+raccourci sans divergence d'état. Approche /tdd recommandée.
