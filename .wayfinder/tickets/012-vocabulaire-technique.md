---
id: 012
title: "Vocabulaire technique : mieux capter les termes anglais et faire respecter le dictionnaire"
label: wayfinder:task
mode: AFK
status: open
assignee: claude (session du 2026-07-19)
blocked-by: []
---

## Question

Retour de validation (Caleb, 2026-07-19) : les mots techniques anglais mêlés au français sont mal transcrits, et les mots du dictionnaire ne sont pas toujours respectés. C'est la faiblesse structurelle de Whisper identifiée par la [recherche Groq](010-recherche-groq-optimisation.md) (code-switching + prompt = suggestion statistique, pas contrainte).

À livrer :
1. **Prompt v2** : base qui démontre le code-switching FR/EN avec de vrais termes dev (Whisper imite le style du prompt), dictionnaire intégré naturellement.
2. **Correcteur de dictionnaire déterministe** : post-passe locale qui matche les mots du transcript contre le dictionnaire en tolérance (distance d'édition adaptée à la longueur, insensible casse/accents, gère les mots coupés/collés) et force la graphie canonique. Seuils conservateurs — jamais de remplacement risqué d'un mot français courant.
3. Option à proposer à Caleb (non incluse) : passe LLM légère en mode TRANSCRIBE avec le dictionnaire (~300 ms de latence en plus).
