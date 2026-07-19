---
id: 012
title: "Vocabulaire technique : mieux capter les termes anglais et faire respecter le dictionnaire"
label: wayfinder:task
mode: AFK
status: closed
assignee: claude (session du 2026-07-19)
blocked-by: []
resolved: 2026-07-19
---

## Question

Retour de validation (Caleb, 2026-07-19) : les mots techniques anglais mêlés au français sont mal transcrits, et les mots du dictionnaire ne sont pas toujours respectés. C'est la faiblesse structurelle de Whisper identifiée par la [recherche Groq](010-recherche-groq-optimisation.md) (code-switching + prompt = suggestion statistique, pas contrainte).

À livrer :
1. **Prompt v2** : base qui démontre le code-switching FR/EN avec de vrais termes dev (Whisper imite le style du prompt), dictionnaire intégré naturellement.
2. **Correcteur de dictionnaire déterministe** : post-passe locale qui matche les mots du transcript contre le dictionnaire en tolérance (distance d'édition adaptée à la longueur, insensible casse/accents, gère les mots coupés/collés) et force la graphie canonique. Seuils conservateurs — jamais de remplacement risqué d'un mot français courant.
3. Option à proposer à Caleb (non incluse) : passe LLM légère en mode TRANSCRIBE avec le dictionnaire (~300 ms de latence en plus).

## Résolution (2026-07-19, commit `bbd4f2f`)

1. **Prompt v2** : la base démontre désormais le code-switching avec de vrais termes (« …je viens de push un commit sur GitHub, le backend expose une API gRPC… ») au lieu de le décrire — Whisper imite le style du prompt.
2. **`DictionaryCorrector`** : post-passe déterministe branchée après la transcription (avant l'ajustement LLM) qui force la graphie canonique des termes du dictionnaire : insensible casse/accents/séparateurs, budget de distance d'édition proportionnel à la longueur (les termes courts exigent l'exact — « bon » n'est jamais transformé en « bun »), gère les mots coupés (« way finder » → « wayfinder »), collés, et les termes multi-mots (« cloud code » → « Claude Code ») ; les termes longs priment sur les courts. Zéro réseau, zéro latence perceptible.
3. **Non inclus, à décider si besoin** : passe LLM légère en mode TRANSCRIBE (llama-3.1-8b + dictionnaire, ~300 ms) — proposée à Caleb, à activer seulement si le correcteur déterministe ne suffit pas à l'usage. Noté au brouillard de la carte.

10 nouveaux tests (dont les non-régressions « comité »/« comme »/« bon »). Suite lib complète verte, type-check/lint verts. Conseil d'usage : plus le dictionnaire est fourni (noms d'outils, de projets, termes récurrents), plus la garantie est large — le correcteur rend chaque entrée réellement contraignante.
