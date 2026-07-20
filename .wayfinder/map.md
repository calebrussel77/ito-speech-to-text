---
label: wayfinder:map
title: Optimisation Ito — fiabilité, exactitude, fluidité (niveau Whisperflow)
created: 2026-07-17
tracker: local-markdown
---

# Optimisation Ito — fiabilité, exactitude, fluidité

## Destination

Sur Windows, Ito dicte avec la fluidité de Whisperflow **au coût minimal** : **Groq seul, optimisé à fond** (language 'fr', prompt FR + lexique, temperature 0, filtrage anti-hallucination, garde-fou VAD — coût zéro sur le free tier), aucune dictée jamais perdue (persistance locale + retries + rejeu), et démarrer un enregistrement n'interrompt plus jamais l'application au premier plan (bug « Ctrl+C dans le terminal Claude » corrigé ✅). Décisions **et** exécution : la carte est finie quand ces changements sont livrés et validés sur la machine de Caleb.

*Révisions : 2026-07-17 — le cadrage initial « passer à AssemblyAI direct » devient une stratégie coût d'abord ; 2026-07-18 — la décision de routage retient Groq seul, AssemblyAI en réserve hors périmètre.*

## Notes

- Domaine : app Electron de dictée speech-to-text — `app/` renderer, `lib/` main/preload, `native/` binaires Rust, `server/` gRPC (hors périmètre).
- Windows d'abord ; parité macOS hors périmètre de cette carte.
- Profil d'usage : français courant, code-switching FR/EN, vocabulaire technique dev, longues dictées (ponctuation/formatage importants).
- Pipeline actuel (référence, exploration du 2026-07-17) : hotkey (rdev, hook WH_KEYBOARD_LL) → cpal/WASAPI 16 kHz mono → buffer mémoire complet → WAV → Groq `whisper-large-v3` en batch (aucun retry, pas de paramètre de langue, dictionnaire injecté en prompt ≤224 tokens) → post-traitement LLM en mode EDIT seulement → insertion par clipboard+paste. Fichiers clés : `lib/main/itoSessionManager.ts`, `lib/main/itoStreamController.ts`, `lib/main/transcription/LocalTranscriptionService.ts`, `lib/main/audio/AudioStreamManager.ts`, `native/audio-recorder/src/main.rs`, `native/global-key-listener/src/main.rs`, `native/text-writer/src/windows_writer.rs`, `lib/main/context/ContextGrabber.ts`.
- Skills à consulter en résolvant : `/verify` avant de clore un ticket d'exécution ; `/tdd` pour les correctifs de fiabilité et la FSM.
- Préférences : code simple (CLAUDE.md), `console.log`, tests via `bun runLibTests` / `cargo test --workspace`.

## Decisions so far

<!-- une ligne par ticket clos : [titre](tickets/xxx.md) — gist de la réponse -->

- [Correctif : Claude coupé au moment du collage](tickets/013-fix-paste-interrupt.md) — Régression du ticket 011 : la capture grammaire déplacée à la complétion envoyait son Ctrl+C simulé au moment du collage, la blocklist ayant raté le terminal de Caleb (2e échec). Corrigé (`b1f5957`) : la capture automatique par simulation clavier est désormais macOS-only — plus aucune frappe synthétique automatique sur Windows, aucune blocklist en jeu.
- [Vocabulaire technique : faire respecter le dictionnaire](tickets/012-vocabulaire-technique.md) — Livré (`bbd4f2f`) : correcteur déterministe post-ASR qui force la graphie canonique des termes du dictionnaire (fuzzy conservateur, multi-mots, mots coupés/collés) + prompt v2 qui démontre le code-switching FR/EN. Option passe LLM notée au brouillard.
- [Correctif : « ©© » tapé au lancement de l'enregistrement](tickets/011-fix-copyright-chars.md) — Cause confirmée : capture grammaire au démarrage simulant Ctrl+C pendant que Win+Alt (le raccourci de Caleb) est encore tenu → Ctrl+Alt+C = ©. Corrigé (`e53f40e`) : capture déplacée à la complétion + aucune simulation clavier tant que des touches sont enfoncées.
- [Fiabilité : ne jamais perdre une dictée](tickets/007-fiabilite-jamais-perdre-dictee.md) — Livré (`d9bc9f3`) : WAV persisté avant l'appel réseau et supprimé après succès, retries avec backoff sur `retry-after`, notification d'échec, récupération automatique vers l'historique au démarrage et après chaque succès. 9 tests.
- [Optimisation Groq : appliquer tous les leviers d'exactitude et de latence](tickets/006-integration-assemblyai.md) — Livré (`02a7fe1`) : `language: 'fr'` (réglage `asrLanguage`), prompt français + dictionnaire (réglage `asrPrompt` ravivé), temperature 0, filtrage anti-hallucination sur tous les segments, garde silence pré-réseau, erreurs typées avec `retryAfterMs` pour la couche retry. 21 tests.
- [Décision : stratégie de routage ASR coût/exactitude](tickets/004-decision-streaming-ou-batch.md) — Groq seul, optimisé à fond (le free tier absorbe l'usage 8x, la fluidité visée est atteignable en batch) ; post-traitement EDIT reste sur Groq ; `language: 'fr'` par défaut avec réglage ; AssemblyAI en réserve hors périmètre, réactivable seulement si la validation finale déçoit sur l'exactitude.
- [Stabilité : machine à états de session explicite](tickets/008-fsm-session.md) — FSM `idle → starting → recording → processing` posée dans `ItoSessionManager` (commit `22a0392`) : double-start impossible, complete attend le start en vol, start échoué re-synchronise l'UI, cancel pendant processing jette le transcript tardif. 6 tests de races ajoutés.
- [Diagnostic + correctif : l'enregistrement envoie un Ctrl+C au terminal](tickets/002-fix-ctrl-c-terminal.md) — Cause confirmée : la capture de contexte au démarrage de session simule Shift+Gauche + Ctrl+C (SIGINT en terminal), et le garde-fou anti-terminal ratait les noms de process Windows et l'app Claude. Corrigé (`f1369a2`) : détection normalisée + fragments, garde ajouté au mode EDIT ; validation réelle par Caleb dans le ticket Validation finale.
- [Commit du travail en cours « son de complétion »](tickets/001-commit-wip-son-completion.md) — Livré en trois commits (`4ad759f`, `b5b0bd0`, `a37a7d0`) : feature + correctifs de types, exclusions lint/git (`opensrc/`, `.history/` — le lint passait de 2h+ à ~60 s), et la carte. Arbre propre ; 11 erreurs `@ts-nocheck` préexistantes hors WIP signalées à part.
- [Recherche : optimiser Groq au maximum](tickets/010-recherche-groq-optimisation.md) — Le free tier Groq tient l'usage de Caleb avec ~8x de marge (8 h d'audio/jour gratuites) ; leviers inexploités : `language: 'fr'`, prompt en FR ponctué avec le lexique, `temperature: 0`, filtrage no_speech/avg_logprob par segment, VAD/durée minimale ; garder large-v3 (pas turbo) et le prétraitement actuel ; Groq n'a pas de streaming ; AssemblyAI ne se justifie que pour le texte live ou si son code-switching prouve sa supériorité à l'essai.
- [Recherche : capacités AssemblyAI pour le profil Ito](tickets/003-recherche-assemblyai.md) — Oui sur toute la ligne : FR supporté en streaming GA (Universal-Streaming Multilingual, code-switching FR/EN natif, P50 303 ms, PCM 16 kHz d'Ito accepté tel quel) ; alternative batch quasi-instantanée découverte (Sync API, ~134 ms par clip < 2 min) ; keyterms jusqu'à 1 000 termes en FR ; ~$2-14/mois selon la voie ; LeMUR mort → LLM Gateway ; $50 de crédits gratuits sans carte.

## Not yet specified

- Micro-latences résiduelles (drain 500 ms à l'arrêt, settle clipboard ~1 s, gathering de contexte synchrone dans le chemin critique) — à re-mesurer après l'optimisation Groq, avant de micro-optimiser.
- Méthodologie de la validation finale : comment mesurer « mesurablement plus exact » (échantillons avant/après ? ressenti seul ?) — à préciser quand les tickets d'exécution seront livrés.
- Passe LLM légère en mode TRANSCRIBE (llama-3.1-8b + dictionnaire, ~300 ms de latence) — seulement si le correcteur déterministe du ticket 012 ne suffit pas à l'usage sur les termes techniques.

## Out of scope

- Parité macOS des correctifs — décision de cadrage du 2026-07-17 : Windows d'abord.
- Nettoyage/décommission du serveur gRPC — il ne participe plus à la transcription (auth/sync uniquement).
- Modèle ASR local/on-device — écarté au profit d'AssemblyAI.
- Bake-off multi-fournisseurs (Deepgram, ElevenLabs, etc.) — la comparaison se limite à Groq et AssemblyAI ; à rouvrir seulement si la validation finale déçoit.
- **AssemblyAI en entier** (décision de routage du 2026-07-18) : [compte/clé API](tickets/005-compte-assemblyai.md) clos sans exécution, intégration retirée du ticket 006 (recentré Groq), streaming/texte live abandonné. Se rouvre uniquement si la [validation finale](tickets/009-validation-finale.md) montre que Groq optimisé ne suffit pas — les deux recherches (003, 010) restent la base factuelle prête à l'emploi.
