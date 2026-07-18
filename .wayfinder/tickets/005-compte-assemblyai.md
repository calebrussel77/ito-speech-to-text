---
id: 005
title: Compte AssemblyAI et clé API
label: wayfinder:task
mode: HITL
status: closed
assignee:
blocked-by: []
resolved: 2026-07-18 (hors périmètre — voir la décision de routage, ticket 004)
---

## Question

*(Révisé le 2026-07-17 : contingent à la [décision de routage](004-decision-streaming-ou-batch.md) — ne créer le compte que si AssemblyAI est retenu dans la stratégie, ou pour l'essai comparatif sur crédits gratuits.)*

Il faut un compte AssemblyAI et une clé API avant toute intégration. Checklist pour Caleb (actions à faire soi-même — création de compte et saisie d'identifiants ne se délèguent pas à l'agent) :

1. Créer le compte sur assemblyai.com — **$50 de crédits gratuits sans carte bancaire** ([pricing](https://www.assemblyai.com/pricing)), largement assez pour tous les essais (~15-30 h/mois coûtent $2-14). Attention en free tier : limite de 5 nouveaux streams/minute (peut gêner des dictées push-to-talk très rapprochées en test streaming) ; passer en pay-as-you-go la lève (100/min).
2. Générer une clé API dans le dashboard.
3. La transmettre à l'app — elle sera stockée chiffrée via Electron `safeStorage`, comme la clé Groq aujourd'hui (`lib/main/store.ts:231-246`).

Réponse à enregistrer en résolution : plan choisi, plafond de dépense éventuel, où la clé vit.
