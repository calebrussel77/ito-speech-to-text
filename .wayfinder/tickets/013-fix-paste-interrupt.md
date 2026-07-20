---
id: 013
title: "Correctif : Claude coupé au moment du collage (grammar grab déplacé par le ticket 011)"
label: wayfinder:task
mode: AFK
status: closed
assignee: claude (session du 2026-07-20)
blocked-by: []
resolved: 2026-07-20
---

## Question

Rapporté par Caleb (2026-07-20, build packagé) : en dictant dans le terminal Claude Code, Claude se coupe **au moment où Ito colle le texte** — même symptôme SIGINT que le ticket 002, mais à l'insertion.

Cause : le ticket 011 a déplacé la capture de contexte grammaire (Shift+Gauche ×4 + Ctrl+C simulés) du démarrage vers la complétion — elle tourne en parallèle de la transcription et atterrit au moment du collage. Le garde-fou par liste de noms d'apps ne reconnaît pas le terminal de Caleb (deuxième échec de la blocklist : noms de process Windows d'abord, celui-ci ensuite).

Correctif visé : ne plus jamais dépendre d'une blocklist pour la capture automatique — sur toute plateforme non-macOS, la lecture de contexte curseur par simulation clavier est désactivée (seul macOS a une voie sûre via l'API d'accessibilité). Le mode EDIT (action délibérée) conserve ses gardes existants.

## Résolution (2026-07-20, commit `b1f5957`)

`canSimulateContextKeystrokes()` (nouveau, dans `applicationDetection.ts`) : la lecture automatique de contexte curseur n'est autorisée que sur macOS. Sur Windows/Linux, `getCursorContextForGrammar` retourne toujours `''` — plus **aucune** frappe synthétique automatique, quel que soit le nom de l'app au premier plan. Le service grammaire dégrade proprement (contexte vide = comportement début-de-texte). Le mode EDIT garde ses gardes (blocklist + attente du relâchement clavier) car c'est une action délibérée sur du texte sélectionné, pas un automatisme.

Décision de conception actée : **plus jamais de blocklist comme seule protection d'un automatisme destructeur** — deux échecs (noms de process Windows au ticket 002, terminal de Caleb ici) prouvent qu'elle ne peut pas garantir « jamais ».

Tests : 6/6 `applicationDetection` (dont la nouvelle garde), suite lib complète verte, type-check/lint verts. À revalider par Caleb sur build packagé : dicter dans le terminal Claude pendant une génération — le collage ne doit plus l'interrompre.
