---
id: 014
title: "Recherche : shortlist des moteurs de transcription longue durée sur OpenRouter"
label: wayfinder:research
mode: AFK
status: closed
assignee: claude (session du 2026-08-07, subagent de recherche)
blocked-by: []
resolved: 2026-08-07
---

## Question

Parmi les **14 modèles de transcription d'OpenRouter** (snapshot : [openrouter-transcription-models-2026-08-07.json](../assets/openrouter-transcription-models-2026-08-07.json)), lesquels — 2 à 3 maximum — sont les meilleurs candidats pour le **mode « enregistrement long » (> ~60 s)** d'Ito, sachant que la priorité de Caleb est **précision d'abord, vitesse ensuite**, sur le profil : français courant, code-switching FR/EN, vocabulaire technique dev, dictées de plusieurs minutes ?

À évaluer par candidat :

1. **Précision long-format FR** — benchmarks/WER publiés, retours d'usage ; exclure ou justifier la lignée Whisper (le mode de défaillance qu'on fuit : hallucinations sur audio long + silences).
2. **Support des hints** — contexte libre / keyword hints (le dictionnaire d'Ito) / language hints, et **comment les passer exactement** via l'API OpenRouter (`provider.options.<slug>`, champs top-level, etc.).
3. **Latence** attendue sur 1–10 min d'audio, et compatibilité avec le timeout de traitement de 60 s d'OpenRouter (à partir de quelle durée faut-il chunker malgré tout ?).
4. **Coût réel** — unités de facturation vérifiées (minute/seconde/heure), projection pour ~20–40 min de dictée longue par jour.
5. **Shape d'appel** — requête exemple complète (multipart et/ou base64 JSON) prête à copier dans le harnais du ticket 015, avec `language`, temperature 0, et hints.

Contexte API déjà établi (docs `guides/overview/multimodal/stt.md`) : `POST https://openrouter.ai/api/v1/audio/transcriptions`, compatible SDK OpenAI (multipart, 25 MB max) ou JSON base64 ; `language`, `temperature`, `response_format: json|verbose_json`, `timestamp_granularities` ; le `prompt` top-level est **ignoré** (passer par `provider.options`) ; timeout de traitement 60 s ; coût réel retourné dans `usage.cost`.

Livrable : shortlist justifiée (2–3 moteurs + Groq chunké comme référence gratuite) écrite dans `.wayfinder/assets/014-shortlist-moteurs-longs.md`.

## Résolution (2026-08-07)

Recherche livrée : [014-shortlist-moteurs-longs.md](../assets/014-shortlist-moteurs-longs.md) (tableau comparatif, curl prêts pour le harnais, sources).

**Shortlist ordonnée :**

1. **`mistralai/voxtral-mini-transcribe`** — $0.003/min (~$2.70/mois à 30 min/jour) ; meilleur WER FR publié (~4 % sur FLEURS vs ~10 % Whisper) ; `context_bias` jusqu'à 100 termes (expérimental hors anglais) ; ~3 s par minute d'audio → 10 min ≈ 30 s, sous le timeout OpenRouter.
2. **`openai/gpt-transcribe`** — $0.0045/min (~$4.05/mois) ; hints les plus riches (`prompt` libre + `keywords` + `languages: ["fr","en"]`, seul à déclarer explicitement le code-switching) ; WER −52 % vs whisper-1 ; latence long-fichier à mesurer au bake-off.
3. **`deepgram/nova-3`** — $0.0043/min (~$3.87/mois) ; keyterm prompting multilingue, code-switching natif 10 langues, batch le plus rapide ; passthrough `provider.options.deepgram` à confirmer au bake-off.

**Écartés :** lignée Whisper (les boucles de répétition/hallucinations sur silences sont documentées — c'est le défaut qu'on fuit) ; `qwen3-asr-flash` malgré son prix (cap dur 3 min / 10 MB).

**Chunking :** inutile pour 1–10 min avec la shortlist ; au-delà de ~10 min chunker quand même (mur 25 MB ≈ 13 min de WAV 16 kHz — ou passer en base64 JSON / OGG-Opus). Référence Groq chunké pour le bake-off : découpage VAD ~60 s aux silences, temperature 0, pas de report de contexte, filtres `no_speech_prob`/`compression_ratio`.

**Rappel API :** hints via `provider.options.<slug>` (le `prompt` top-level d'OpenRouter est ignoré) ; unités de prix hétérogènes ($/min, $/s pour qwen, $/h pour grok) ; coût réel dans `usage.cost` de chaque réponse.
