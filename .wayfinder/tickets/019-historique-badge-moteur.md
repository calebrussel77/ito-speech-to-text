---
id: 019
title: "Historique : badge du moteur + liste d'activité modernisée"
label: wayfinder:task
mode: AFK
status: closed
assignee: claude (session du 2026-08-07)
blocked-by: []
resolved: 2026-08-07
---

## Question

Demande de Caleb (2026-08-07) : dans Recent activity, savoir quel moteur a transcrit chaque dictée (GPT Transcribe / Whisper / Mistral), limiter l'affichage des transcripts à 3 lignes avec « voir plus », et moderniser la liste.

## Résolution (2026-08-07)

Livré (`cd5b67c`) :

- **Attribution du moteur** : `LocalTranscriptionResult.asrEngine` renseigné dans le contrôleur (modèle OpenRouter si ce chemin a répondu, sinon le modèle Groq — y compris après repli), stocké dans `asr_output.engine` (JSON libre, aucune migration), aussi sur les dictées récupérées.
- **UI** : ligne méta (heure · badge moteur coloré · durée), transcript en `line-clamp-3` avec bascule Show more/Show less (seuil ~240 caractères ou > 3 sauts de ligne), actions alignées sur le nouveau layout. Badges : GPT Transcribe (violet), Mistral Voxtral (orange), Whisper · Groq (bleu), id brut en badge neutre pour un moteur inconnu ; les anciennes lignes sans attribution n'affichent pas de badge.
- Vérification : 30 fichiers de tests lib sans échec, type-check et lint propres.
