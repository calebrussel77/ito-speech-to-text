---
id: 013
title: "Correctif : Claude coupé au moment du collage (grammar grab déplacé par le ticket 011)"
label: wayfinder:task
mode: AFK
status: open
assignee: claude (session du 2026-07-20)
blocked-by: []
---

## Question

Rapporté par Caleb (2026-07-20, build packagé) : en dictant dans le terminal Claude Code, Claude se coupe **au moment où Ito colle le texte** — même symptôme SIGINT que le ticket 002, mais à l'insertion.

Cause : le ticket 011 a déplacé la capture de contexte grammaire (Shift+Gauche ×4 + Ctrl+C simulés) du démarrage vers la complétion — elle tourne en parallèle de la transcription et atterrit au moment du collage. Le garde-fou par liste de noms d'apps ne reconnaît pas le terminal de Caleb (deuxième échec de la blocklist : noms de process Windows d'abord, celui-ci ensuite).

Correctif visé : ne plus jamais dépendre d'une blocklist pour la capture automatique — sur toute plateforme non-macOS, la lecture de contexte curseur par simulation clavier est désactivée (seul macOS a une voie sûre via l'API d'accessibilité). Le mode EDIT (action délibérée) conserve ses gardes existants.
