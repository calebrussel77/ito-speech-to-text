---
id: 002
title: "Diagnostic + correctif : démarrer un enregistrement envoie un Ctrl+C au terminal"
label: wayfinder:task
mode: AFK
status: open
assignee:
blocked-by: [001]
---

## Question

Symptôme (rapporté par Caleb, 2026-07-17) : dès que l'enregistrement démarre — par la pill **ou** par le raccourci — Claude Code dans le terminal au premier plan se coupe, comme un Ctrl+C. Whisperflow ne provoque pas ça.

Hypothèse principale (quasi confirmée par lecture du code) : au démarrage de session, `itoSessionManager.startSession` pré-charge le contexte (`itoSessionManager.ts:48`), ce qui fait lire le texte sélectionné par le `selected-text-reader`, lequel **simule un Ctrl+C** ; le hook clavier laisse volontairement passer Ctrl+C sans le reporter (`native/global-key-listener/src/main.rs:153-160,239-247`, « avoid feedback loops with the selected-text reader »). Dans un terminal, Ctrl+C = SIGINT → Claude Code interrompu. Cohérent avec le fait que les deux modes de déclenchement produisent le symptôme.

À faire : (1) instrumenter/confirmer que le Ctrl+C synthétique part bien au démarrage de session et atteint l'app au premier plan ; (2) corriger — options : ne jamais simuler Ctrl+C quand l'app au premier plan est un terminal (détection déjà existante dans `windows_writer.rs:178-194` pour le paste), remplacer la lecture de sélection par UI Automation sur Windows, ou ne lire la sélection qu'en mode EDIT ; (3) vérifier au passage les vecteurs secondaires relevés : injection de touche synthétique `Unknown(0xFF)` lors des hotkeys Meta (`main.rs:198-208`), client de capture WASAPI ouvert dès le lancement (`main.rs:184-205`).

Résolu = dicter dans le terminal Claude Code ne l'interrompt plus, dans les deux modes de déclenchement.
