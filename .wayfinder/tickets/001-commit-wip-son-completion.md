---
id: 001
title: Commit du travail en cours « son de complétion »
label: wayfinder:task
mode: AFK
status: closed
assignee: claude (session du 2026-07-17)
blocked-by: []
resolved: 2026-07-17
---

## Question

Le worktree contient une feature non commitée (son de complétion d'interaction : `lib/main/soundFeedback.ts`, `app/utils/interactionSoundPlayer.ts`, `resources/sounds/`, modifs `itoSessionManager` / `store` / settings UI / IPC / config de build). Les tickets d'exécution de cette carte touchent les mêmes fichiers — il faut partir d'un état net.

À faire : vérifier `bun runLibTests` + `bun lint` + `bun type-check`, puis committer proprement. Point à trancher au passage : `opensrc/` (app tierce vendorée en référence, `cjpais--handy`) ne doit probablement pas être commité — l'ajouter au `.gitignore` ou confirmer son sort avec Caleb. Le dossier `.wayfinder/` (cette carte) peut être commité avec.

## Résolution (2026-07-17)

Fait, en trois commits sur `main` :
- `4ad759f` — la feature son de complétion, plus trois correctifs trouvés par les vérifications : deux erreurs de types (buffer du `Blob` dans `interactionSoundPlayer.ts`, type de retour explicite de `resolveActiveSoundPath`) et un warning de variable inutilisée (`store.ts`).
- `b5b0bd0` — `opensrc/` ignoré côté git **et** ESLint, plus `.history/`, `release/` et les caches côté ESLint. Découverte en passant : le lint typé (`projectService`) partait en runs de plusieurs heures à 2,7 Go de RAM à cause des 305 fichiers TS orphelins de `.history/` et de l'app vendorée — réglé, le lint prend maintenant ~60 s.
- `a37a7d0` — la carte wayfinder.

Tests lib 8/8 verts, type-check vert. Reste connu, hors périmètre de cette carte : `bun lint` sort encore 11 erreurs `@ts-nocheck` **préexistantes** dans des fichiers non touchés (signalé comme tâche séparée).
