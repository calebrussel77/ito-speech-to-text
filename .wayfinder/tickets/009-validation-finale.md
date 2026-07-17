---
id: 009
title: "Validation finale : exactitude, latence, dictée dans le terminal Claude"
label: wayfinder:task
mode: HITL
status: open
assignee:
blocked-by: [002, 006, 007, 008]
---

## Question

Valider que la destination est atteinte, avec Caleb comme juge :

1. Dicter dans le terminal Claude Code pendant qu'il génère — aucune interruption, dans les deux modes de déclenchement.
2. Exactitude ressentie sur les vrais usages (FR, FR/EN mélangé, vocabulaire technique, longues dictées) vs l'ancien pipeline Groq.
3. Latence/fluidité comparée à Whisperflow côte à côte.
4. Test de panne : couper le réseau en pleine dictée — rien n'est perdu, la notification apparaît, le rejeu fonctionne.

Si un critère échoue : rouvrir le ticket concerné, ou — si c'est l'exactitude AssemblyAI qui déçoit — sortir le bake-off multi-fournisseurs du hors-périmètre en redessinant la destination.
