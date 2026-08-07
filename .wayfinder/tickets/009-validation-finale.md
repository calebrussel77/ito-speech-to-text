---
id: 009
title: "Validation finale : exactitude, latence, dictée dans le terminal Claude"
label: wayfinder:task
mode: HITL
status: closed
assignee: claude (session du 2026-08-07, grilling avec Caleb)
blocked-by: [002, 006, 007, 008]
resolved: 2026-08-07
---

## Question

Valider que la destination est atteinte, avec Caleb comme juge :

1. Dicter dans le terminal Claude Code pendant qu'il génère — aucune interruption, dans les deux modes de déclenchement.
2. Exactitude ressentie sur les vrais usages (FR, FR/EN mélangé, vocabulaire technique, longues dictées) vs l'ancien pipeline Groq.
3. Latence/fluidité comparée à Whisperflow côte à côte.
4. Test de panne : couper le réseau en pleine dictée — rien n'est perdu, la notification apparaît, le rejeu fonctionne.

Si un critère échoue : rouvrir le ticket concerné, ou — si c'est l'exactitude AssemblyAI qui déçoit — sortir le bake-off multi-fournisseurs du hors-périmètre en redessinant la destination.

## Résolution (2026-08-07, verdict de Caleb en usage réel — build 0.1.3)

**Validation partielle : trois critères sur quatre passent, l'exactitude longue durée échoue.**

1. ✅ **Terminal Claude** : le bug Ctrl+C est mort depuis les correctifs 002/011/013 — confirmé en usage réel.
2. ⚠️ **Exactitude** : les enregistrements **courts conviennent** ; au-delà d'**environ 1 minute**, Whisper (Groq) dérape — phrases inventées, sorties de contexte, imprécisions récurrentes. C'est le mode de défaillance long-format connu de la lignée Whisper (fenêtres 30 s + silences → hallucinations).
3. ✅ **Fiabilité** : aucune dictée perdue depuis les correctifs (persistance + retries + rejeu).
4. (Latence vs Whisperflow : non contestée, jugée acceptable.)

**Conséquence — clause de réouverture activée :** le routage multi-moteurs sort du hors-périmètre, mais par **OpenRouter** et non AssemblyAI : OpenRouter expose depuis peu un endpoint de transcription unifié (`POST /api/v1/audio/transcriptions`, compatible OpenAI, multipart ou base64) avec **14 modèles STT** interchangeables par simple changement de chaîne `model` (openai/gpt-transcribe, deepgram/nova-3, mistralai/voxtral-mini-transcribe, qwen/qwen3-asr-flash…). Caleb a un compte OpenRouter approvisionné. Cible retenue : **mode Auto** — court (≤ ~60 s) → Groq gratuit inchangé, long → moteur payant précis à sélectionner (bake-off), avec forçage manuel possible dans les settings. Snapshot du catalogue : [openrouter-transcription-models-2026-08-07.json](../assets/openrouter-transcription-models-2026-08-07.json).

Suites créées : recherche 014 (shortlist moteurs longs), prototype 015 (bake-off sur vraies dictées), décision 016 (routage + UX settings), exécution 017.
