---
id: 016
title: "Décision : routage Auto court/long + UX des réglages + post-traitement"
label: wayfinder:grilling
mode: HITL
status: closed
assignee: claude (session du 2026-08-07, grilling avec Caleb)
blocked-by: [015]
resolved: 2026-08-07
---

## Question

Arrêter la conception du routage multi-moteurs, le bake-off 015 ayant désigné le moteur long :

1. **Seuil Auto** : bascule court/long à ~60 s (durée d'enregistrement) — valeur exacte, et faut-il l'exposer en réglage avancé ?
2. **UX settings** : un seul sélecteur « Moteur de transcription : Auto (recommandé) / Groq / <moteur long> » plutôt que 3 modes nommés ? Où loger la clé OpenRouter (stockage sécurisé, champ settings) ?
3. **Fallback** : si l'appel OpenRouter échoue (réseau, quota, clé absente), replier sur Groq (chunké ?) plutôt que d'échouer — comment le signaler à l'utilisateur ?
4. **Post-traitement** : le mode long garde-t-il llama-3.1-8b sur Groq (gratuit), ou passe-t-il à un modèle via OpenRouter (ex. google/gemini-3.1-flash-lite, dispo au catalogue) ? Absorbe aussi la question au brouillard « passe LLM légère en mode TRANSCRIBE » (si le moteur long respecte déjà le dictionnaire via hints, le correcteur déterministe du 012 suffit-il ?).
5. **Chunking Groq** : si le bake-off montre que Groq chunké rivalise, décider s'il devient le mode long par défaut (coût zéro) avec OpenRouter en option qualité.

## Résolution (2026-08-07 — validée par Caleb, cinq points + un amendement)

1. **Moteur long : `openai/gpt-transcribe`** par défaut (double gagnant du bake-off 015), ~$0.011 la dictée longue, latence ~81 s pour 2,5 min acceptée.
2. **Seuil Auto : 60 s** de durée d'enregistrement — en dessous, pipeline Groq actuel inchangé ; au-dessus, OpenRouter.
3. **Settings** : un sélecteur « Moteur : Auto (recommandé) / Groq uniquement / OpenRouter uniquement » + champ clé OpenRouter (stockage local sécurisé). **Amendement de Caleb : le modèle OpenRouter du mode long est lui-même un réglage** — choix entre `openai/gpt-transcribe` (défaut) et `mistralai/voxtral-mini-transcribe` (le repli 2e du bake-off, plus rapide et moins cher) **sans modification de code ni rebuild**. Implémentation : l'id de modèle est une chaîne stockée dans les settings (dropdown des deux valeurs éprouvées) — en ajouter d'autres plus tard = ajouter une entrée à la liste, pas une logique.
4. **Fallback** : échec OpenRouter (clé absente, réseau, quota) → la dictée repart sur Groq et hérite de toute la couche fiabilité existante (persistance WAV, retries, rejeu — ticket 007). Une dictée longue ne doit jamais être perdue ni bloquée par le mode précis.
5. **Post-traitement inchangé** : llama-3.1-8b sur Groq, mode EDIT seulement ; pas de passe LLM supplémentaire en TRANSCRIBE (les hints de gpt-transcribe + le correcteur déterministe du 012 couvrent le dictionnaire) — la question au brouillard est close.

Hints du mode long (établis au bake-off, harnais dans [015-bakeoff/](../assets/015-bakeoff/)) : `provider.options.openai = { prompt: contexte dictée technique FR/EN, keywords: dictionnaire, languages: ['fr','en'] }` pour gpt-transcribe ; `provider.options.mistral.context_bias` + `language: 'fr'` pour voxtral ; `temperature: 0`, voie base64 JSON, coût réel loggable via `usage.cost`.
