---
id: 001
title: Commit du travail en cours « son de complétion »
label: wayfinder:task
mode: AFK
status: open
assignee: claude (session du 2026-07-17)
blocked-by: []
---

## Question

Le worktree contient une feature non commitée (son de complétion d'interaction : `lib/main/soundFeedback.ts`, `app/utils/interactionSoundPlayer.ts`, `resources/sounds/`, modifs `itoSessionManager` / `store` / settings UI / IPC / config de build). Les tickets d'exécution de cette carte touchent les mêmes fichiers — il faut partir d'un état net.

À faire : vérifier `bun runLibTests` + `bun lint` + `bun type-check`, puis committer proprement. Point à trancher au passage : `opensrc/` (app tierce vendorée en référence, `cjpais--handy`) ne doit probablement pas être commité — l'ajouter au `.gitignore` ou confirmer son sort avec Caleb. Le dossier `.wayfinder/` (cette carte) peut être commité avec.
