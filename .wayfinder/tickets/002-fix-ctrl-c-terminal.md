---
id: 002
title: "Diagnostic + correctif : démarrer un enregistrement envoie un Ctrl+C au terminal"
label: wayfinder:task
mode: AFK
status: closed
assignee: claude (session du 2026-07-18)
blocked-by: [001]
resolved: 2026-07-18
---

## Question

Symptôme (rapporté par Caleb, 2026-07-17) : dès que l'enregistrement démarre — par la pill **ou** par le raccourci — Claude Code dans le terminal au premier plan se coupe, comme un Ctrl+C. Whisperflow ne provoque pas ça.

Hypothèse principale (quasi confirmée par lecture du code) : au démarrage de session, `itoSessionManager.startSession` pré-charge le contexte (`itoSessionManager.ts:48`), ce qui fait lire le texte sélectionné par le `selected-text-reader`, lequel **simule un Ctrl+C** ; le hook clavier laisse volontairement passer Ctrl+C sans le reporter (`native/global-key-listener/src/main.rs:153-160,239-247`, « avoid feedback loops with the selected-text reader »). Dans un terminal, Ctrl+C = SIGINT → Claude Code interrompu. Cohérent avec le fait que les deux modes de déclenchement produisent le symptôme.

À faire : (1) instrumenter/confirmer que le Ctrl+C synthétique part bien au démarrage de session et atteint l'app au premier plan ; (2) corriger — options : ne jamais simuler Ctrl+C quand l'app au premier plan est un terminal (détection déjà existante dans `windows_writer.rs:178-194` pour le paste), remplacer la lecture de sélection par UI Automation sur Windows, ou ne lire la sélection qu'en mode EDIT ; (3) vérifier au passage les vecteurs secondaires relevés : injection de touche synthétique `Unknown(0xFF)` lors des hotkeys Meta (`main.rs:198-208`), client de capture WASAPI ouvert dès le lancement (`main.rs:184-205`).

Résolu = dicter dans le terminal Claude Code ne l'interrompt plus, dans les deux modes de déclenchement.

## Résolution (2026-07-18, commit `f1369a2`)

**Cause racine confirmée par lecture du code** — deux chemins envoient des frappes synthétiques dans l'app au premier plan :
1. **Au démarrage de chaque session**, si `grammarServiceEnabled` : `prepareGrammarContext` → `getCursorContextForGrammar` → fallback clavier → **Shift+Gauche ×4 puis Ctrl+C** (`native/selected-text-reader/src/windows.rs:19-28,31-53`). Dans un terminal, Ctrl+C = SIGINT → Claude Code interrompu. Cohérent avec le déclenchement par pill ET par raccourci (les deux convergent sur `startSession`).
2. **En mode EDIT**, `getContextText` lisait la sélection (Ctrl+C aussi) **sans aucun garde-fou**.

**Pourquoi le garde-fou existant ratait** : `isTerminalApplication` comparait le nom d'app en exact-match contre des libellés humains (« windows terminal »), alors que Windows renvoie souvent le nom de process (`WindowsTerminal`, `cmd.exe`) — et le terminal intégré de l'app desktop **Claude** s'appelle « Claude », absent de la liste. Whisperflow ne fait aucune capture de contexte, d'où son immunité.

**Correctif** (`lib/utils/applicationDetection.ts`, `lib/main/context/ContextGrabber.ts`) :
- Normalisation (`lowercase`, strip `.exe`) + noms de process Windows + apps à terminal intégré (Claude, Cursor, Windsurf…) + **matching par fragments** (`term`, `console`, `cmd`, `shell`, `bash`, `claude`…). Biais assumé vers les faux positifs : un faux positif saute juste la lecture de contexte (bénin), un faux négatif envoie un SIGINT (destructeur).
- Garde `canGetContextFromCurrentApp()` ajouté au chemin EDIT.
- 5 tests unitaires (`lib/utils/applicationDetection.test.ts`), suite lib complète verte, type-check et lint verts.

**Vecteurs secondaires examinés** : l'injection `Unknown(0xFF)` (hotkeys Meta) envoie un keycode invalide que les terminaux ignorent — pas un vecteur SIGINT ; le client WASAPI ouvert au lancement est en mode partagé — sans effet sur un process terminal. Non modifiés.

**Validation runtime restante** : la dictée réelle dans le terminal Claude pendant une génération est couverte par le ticket [Validation finale](009-validation-finale.md) — à confirmer par Caleb à la prochaine utilisation (relancer l'app pour charger le fix).
