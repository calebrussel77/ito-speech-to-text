---
id: 018
title: "Presse-papier : conserver le transcript après le collage"
label: wayfinder:task
mode: AFK
status: closed
assignee: claude (session du 2026-08-07)
blocked-by: []
resolved: 2026-08-07
---

## Question

Cas rapporté par Caleb (2026-08-07) : pendant une transcription longue il change de fenêtre ; le collage atterrit sur une fenêtre sans champ de saisie et le texte est **perdu** — il n'est même plus dans le presse-papier. Faire que le transcript reste disponible via Ctrl+V.

## Résolution (2026-08-07)

Cause : `type_text_windows` (native/text-writer) restaurait l'ancien presse-papier **1 s après** le collage — un collage raté effaçait donc la seule copie du texte.

Livré (`7854a67`) : la restauration est supprimée — le transcript **reste dans le presse-papier** après chaque collage (un raté se rattrape d'un Ctrl+V). Effet de bord positif : le sleep de 1 s disparaît de chaque insertion (c'était la « settle clipboard ~1 s » du brouillard micro-latences). Contrepartie assumée : le contenu précédent du presse-papier n'est plus restauré. Windows uniquement (macOS hors périmètre). Clippy propre, binaire release reconstruit.
