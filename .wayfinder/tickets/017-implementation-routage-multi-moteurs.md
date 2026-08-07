---
id: 017
title: "Exécution : implémenter le routage multi-moteurs et les réglages"
label: wayfinder:task
mode: AFK
status: closed
assignee: claude (session du 2026-08-07)
blocked-by: [016]
resolved: 2026-08-07
---

## Question

Implémenter la décision 016 dans Ito :

- Routage par durée dans le pipeline de transcription (`LocalTranscriptionService` / `ItoSessionManager`) : < 60 s → Groq inchangé, ≥ 60 s → OpenRouter (`POST /api/v1/audio/transcriptions`, voie base64 JSON, temperature 0, hints par moteur — shapes exactes dans la résolution du ticket 016 et le harnais `assets/015-bakeoff/`).
- Réglages : sélecteur « Auto (défaut) / Groq / OpenRouter » + **dropdown du modèle long** (`openai/gpt-transcribe` par défaut, `mistralai/voxtral-mini-transcribe` en alternative — id stocké en chaîne, changeable sans rebuild) + champ clé OpenRouter (stockage sécurisé). Fallback : échec OpenRouter → Groq + couche fiabilité (007), avec notification discrète.
- Réutiliser la couche fiabilité existante (persistance WAV, retries avec `retryAfterMs`, rejeu — ticket 007) pour le nouveau chemin réseau.
- Tests (`bun runLibTests`) : routage par durée, fallback, erreurs typées OpenRouter ; `/verify` avant de clore.
- Validation finale par Caleb sur de vraies dictées longues (mini-ticket HITL de recette à créer à la livraison si utile).

## Résolution (2026-08-07)

**Livré (`5988bf4`).** Contenu :

- `OpenRouterTranscriptionService` (nouveau) : endpoint unifié base64 JSON, hints par moteur (gpt-transcribe : `prompt` + `keywords` + `languages:['fr','en']` via `provider.options.openai` ; voxtral : `language` + `context_bias` via `provider.options.mistral` ; cap 100 termes), temperature 0, timeout 180 s, coût réel loggé (`usage.cost`), erreurs mappées sur les codes existants (`INVALID_API_KEY`/`RATE_LIMIT` avec `retry-after`/`NETWORK`/`MODEL_ERROR`) ; une transcription **vide** est traitée en erreur pour déclencher le repli (leçon nova-3 du bake-off).
- Routage dans `ItoStreamController` : `auto` (défaut) → OpenRouter si durée ≥ 60 s et clé présente ; modes forcés `groq`/`openrouter` ; tout échec OpenRouter → repli Groq + couche persistance/retries du ticket 007, avec notification discrète.
- Settings : sélecteur Auto/Groq/OpenRouter + dropdown du modèle long (changeable sans rebuild) dans Advanced Settings ; carte « OpenRouter API Key » (Save/Clear/Test via `GET /api/v1/key`) ; clé chiffrée au repos via safeStorage comme la clé Groq (champ `openRouterApiKeyEncrypted`).
- Vérification : 12 tests unitaires service + 6 tests de routage (30 fichiers de tests lib, 0 échec), `bun type-check` ✅, `bun lint` 0 erreur, prettier ✅, `electron-vite build` complet ✅.

Reste (au brouillard de la carte) : la **recette** — Caleb redémarre l'app (`bun dev` ou rebuild packagé), pose sa clé OpenRouter durable dans les settings, et dicte > 1 min en usage réel.
