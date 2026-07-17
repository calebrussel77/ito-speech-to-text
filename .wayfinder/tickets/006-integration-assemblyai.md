---
id: 006
title: Intégration de la stratégie ASR décidée (Groq optimisé + routage éventuel AssemblyAI)
label: wayfinder:task
mode: AFK
status: open
assignee:
blocked-by: [001, 004, 005]
---

## Question

*(Révisé le 2026-07-17 : n'est plus « remplacer Groq par AssemblyAI » mais implémenter la stratégie de routage décidée dans [le ticket de décision](004-decision-streaming-ou-batch.md).)*

Implémenter la stratégie retenue :

- **Volet Groq (certain quel que soit le routage)** : optimiser `LocalTranscriptionService` — paramètre de langue, modèle retenu, prompt retravaillé selon les findings de [Recherche Groq](010-recherche-groq-optimisation.md), correction du `no_speech` (aujourd'hui seul le premier segment est vérifié), gestion d'erreurs typée (remplacer le string-sniffing de `LocalTranscriptionService.ts:162-180`).
- **Volet AssemblyAI (si retenu)** : intégration selon la voie décidée (Sync API ou streaming), clé via `safeStorage`, dictionnaire en keyterms, et la logique de routage (durée/échec/mode) avec fallback propre d'un fournisseur vers l'autre.
- Settings : refléter la stratégie dans Advanced Settings sans exploser la complexité (garder simple, cf. CLAUDE.md).

Résolu = dictée FR/EN de bout en bout selon la stratégie décidée sur la machine de Caleb, tests `bun runLibTests` verts. Si la décision retient un essai comparatif préalable, il se fait dans le ticket de décision, pas ici.
