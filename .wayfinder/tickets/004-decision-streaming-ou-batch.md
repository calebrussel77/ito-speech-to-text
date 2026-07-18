---
id: 004
title: "Décision : stratégie de routage ASR coût/exactitude (Groq par défaut, AssemblyAI ciblé)"
label: wayfinder:grilling
mode: HITL
status: closed
assignee: claude (session du 2026-07-18)
blocked-by: [003, 010]
resolved: 2026-07-18
---

## Question

*(Révisé le 2026-07-17 : la question initiale « streaming ou batch AssemblyAI » est élargie — le cadrage est désormais coût d'abord, Groq par défaut.)*

Au vu des faits de [Recherche AssemblyAI](003-recherche-assemblyai.md) (close) et de [Recherche Groq](010-recherche-groq-optimisation.md), trancher avec Caleb la stratégie de transcription au meilleur rapport exactitude/coût :

1. **Groq seul, optimisé au maximum** — paramètre de langue, meilleur modèle (turbo ?), prompts retravaillés, VAD/no_speech corrigé. Coût ~0. Suffit-il pour le profil FR/EN technique ?
2. **Hybride routé** — Groq par défaut ; AssemblyAI seulement sur des critères précis à définir : durée (ex. > X s), échec/faible confiance Groq, mode EDIT, ou bascule manuelle. Critères de routage = cœur de la décision.
3. **AssemblyAI ciblé streaming** — Groq pour tout le batch, AssemblyAI streaming multilingue ($0.15/h, P50 303 ms, code-switching natif) uniquement si la fluidité temps réel s'avère indispensable à l'objectif Whisperflow.

Rappels des faits AssemblyAI utiles : Sync API ~134 ms par clip < 2 min ($0.45/h) ; streaming facturé à la durée de session WebSocket ; $50 de crédits gratuits ; keyterms 1 000 termes FR sur U3 Pro.

Faits Groq (recherche close) qui cadrent la décision : **le free tier tient l'usage avec ~8x de marge** (8 h d'audio/jour gratuites) ; pas de streaming chez Groq ; la recherche recommande « tout Groq free tier, AssemblyAI seulement pour le texte live ou si son code-switching FR/EN prouve sa supériorité à l'essai gratuit » ; le Sync API AssemblyAI à $0.45/h est déconseillé (3-4x le prix pour un gain de latence que Groq batch donne déjà). La vraie question restante est donc : **le texte partiel en direct pendant la dictée vaut-il $2-5/mois et la complexité streaming, ou le Groq optimisé (latence ~0,3-1 s par clip) suffit-il à l'objectif Whisperflow ?**

À trancher dans la même session :
- La stratégie ci-dessus et, si hybride, les critères de routage exacts.
- Sort du post-traitement LLM du mode EDIT : reste Groq, migre LLM Gateway AssemblyAI (LeMUR est mort), ou supprimé.
- Hint de langue côté Groq (forcer `fr` ? auto ?) et côté AssemblyAI.
- Si streaming retenu quelque part : affichage du texte partiel dans l'UI (pill) ou insertion à la fin.
- Un essai comparatif rapide sur tes vrais audios (crédits gratuits AssemblyAI + free tier Groq) avant de figer, ou décision directe sur pièces.

## Résolution (2026-07-18, décidé avec Caleb)

1. **Groq seul, optimisé à fond.** Pas d'AssemblyAI dans cette carte : le free tier Groq absorbe l'usage avec 8x de marge, la fluidité visée (insertion au relâchement, ~0,3-1 s) est atteignable en batch — Whisperflow fonctionne pareil. Leviers à appliquer : `language`, prompt FR ponctué avec lexique, `temperature: 0`, filtrage anti-hallucination par segment, garde-fou VAD/durée, erreurs typées, modèle en config.
2. **Post-traitement LLM du mode EDIT : reste sur Groq** (`llama-3.1-8b-instant` ou successeur en config). Le LLM Gateway d'AssemblyAI n'apporte rien sans AssemblyAI au périmètre.
3. **Langue : `language: 'fr'` par défaut**, avec un réglage dans Advanced Settings pour changer/désactiver (protège le cas dictée 100 % anglaise où forcer `fr` risque une traduction silencieuse).
4. **AssemblyAI : en réserve, hors périmètre.** Les tickets [compte AssemblyAI](005-compte-assemblyai.md) et le volet AssemblyAI de [l'intégration](006-integration-assemblyai.md) sortent de la carte. AssemblyAI redevient d'actualité uniquement si la [validation finale](009-validation-finale.md) montre que l'exactitude Groq optimisé ne suffit pas — notamment sur le code-switching FR/EN, faiblesse structurelle de Whisper.

Conséquences sur la carte : ticket 005 clos (hors périmètre), ticket 006 recentré « Optimisation Groq », ticket 007 débloqué.
