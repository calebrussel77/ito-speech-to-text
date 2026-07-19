---
id: 011
title: "Correctif : « ©© » tapé dans l'input au lancement de l'enregistrement"
label: wayfinder:task
mode: AFK
status: closed
assignee: claude (session du 2026-07-19)
blocked-by: []
resolved: 2026-07-19
---

## Question

Rapporté par Caleb lors de la validation (2026-07-19) : au lancement d'un enregistrement, « ©© » s'écrit dans l'input focalisé avant la dictée.

Hypothèse : la capture de contexte grammaire (`prepareGrammarContext`) tourne au **démarrage** de session — pendant que les touches du raccourci push-to-talk sont encore physiquement enfoncées. Le `selected-text-reader` simule Ctrl+C ; avec Alt encore tenu par l'utilisateur, l'app reçoit **Ctrl+Alt+C = ©** (deux copies simulées → deux ©). Défaut structurel : ne jamais synthétiser de frappes pendant que des touches utilisateur sont enfoncées.

Correctif visé : déplacer la capture grammaire du démarrage vers la complétion (en parallèle de l'appel réseau — zéro latence ajoutée), et faire attendre le relâchement complet du clavier avant toute simulation (grammaire ET lecture de sélection en mode EDIT).

## Résolution (2026-07-19, commit `e53f40e`)

Hypothèse **confirmée par Caleb** : son raccourci est **Win + Alt** — le Ctrl+C simulé arrivait comme Ctrl+Alt+C = « © » (deux copies simulées → « ©© »).

Correctif double :
1. **La capture grammaire ne tourne plus au démarrage de session** : déplacée dans `completeSession`, lancée en parallèle de l'appel de transcription (zéro latence ajoutée), attendue juste avant l'application des règles de grammaire à l'insertion.
2. **Aucune simulation clavier tant que des touches sont physiquement enfoncées** : nouveau module `lib/media/keyboardState.ts` (extrait de `keyboard.ts` pour éviter un cycle d'imports) exposant `waitForAllKeysReleased()` ; le `ContextGrabber` l'attend avant la lecture du contexte curseur **et** la lecture de sélection en mode EDIT — au timeout (touche coincée), la lecture est sautée plutôt que de taper dans l'app de l'utilisateur.

Tests : 4 nouveaux (`keyboardState`), test de session mis à jour (grammaire capturée à la complétion, plus au démarrage). Suite lib complète verte, type-check/lint verts. À revalider par Caleb après redémarrage de l'app (fait partie de la validation finale).
