---
id: 011
title: "Correctif : « ©© » tapé dans l'input au lancement de l'enregistrement"
label: wayfinder:task
mode: AFK
status: open
assignee: claude (session du 2026-07-19)
blocked-by: []
---

## Question

Rapporté par Caleb lors de la validation (2026-07-19) : au lancement d'un enregistrement, « ©© » s'écrit dans l'input focalisé avant la dictée.

Hypothèse : la capture de contexte grammaire (`prepareGrammarContext`) tourne au **démarrage** de session — pendant que les touches du raccourci push-to-talk sont encore physiquement enfoncées. Le `selected-text-reader` simule Ctrl+C ; avec Alt encore tenu par l'utilisateur, l'app reçoit **Ctrl+Alt+C = ©** (deux copies simulées → deux ©). Défaut structurel : ne jamais synthétiser de frappes pendant que des touches utilisateur sont enfoncées.

Correctif visé : déplacer la capture grammaire du démarrage vers la complétion (en parallèle de l'appel réseau — zéro latence ajoutée), et faire attendre le relâchement complet du clavier avant toute simulation (grammaire ET lecture de sélection en mode EDIT).
