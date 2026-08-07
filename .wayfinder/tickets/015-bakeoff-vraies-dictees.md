---
id: 015
title: "Prototype : bake-off des moteurs longs sur de vraies dictées de Caleb"
label: wayfinder:prototype
mode: HITL
status: closed
assignee: claude (session du 2026-08-07, jugement à l'aveugle par Caleb)
blocked-by: [014]
resolved: 2026-08-07
---

## Question

Sur de **vraies dictées longues de Caleb** (2–3 enregistrements > 1 min, FR + code-switching + vocabulaire technique), quel moteur de la shortlist 014 produit la meilleure transcription — jugée par Caleb, à l'aveugle si possible ?

Démarche :

1. Harnais jetable (script) qui envoie **le même WAV** aux candidats shortlistés via l'endpoint OpenRouter unifié + à **Groq chunké** (découpage VAD ~60 s avec chevauchement, référence gratuite), avec les mêmes hints (dictionnaire, `language`).
2. Sortie côte à côte : transcription, latence mesurée, coût réel (`usage.cost`).
3. Caleb désigne le gagnant ; noter aussi si Groq chunké suffit (auquel cas le mode long resterait gratuit).

Prérequis : une clé OpenRouter durable fournie par Caleb au moment du test (la clé du 2026-08-07 était temporaire — **ne jamais committer de clé**).

**Source des audios — correction du 2026-08-07 :** l'historique Ito ne conserve **pas** l'audio. Vérifié dans `Ito-prod\ito.db` (1693 interactions, `raw_audio` NULL partout) : `itoSessionManager.ts` passe volontairement `Buffer.alloc(0)` (« we intentionally do not persist audio in local-only mode »), et `pending-dictations/` est vide (les WAV n'y survivent qu'aux échecs — ticket 007). La dictée hallucinée du 2026-08-07 11h34 (« OpenMotor » pour OpenRouter, « GPT-Rualtime », « l'API de Vaucantum », « GROK avec Whisper » pour Groq) n'est donc pas rejouable ; sa transcription fautive reste en DB comme référence du défaut. → Caleb enregistre les échantillons à la demande (Enregistreur vocal Windows, .m4a accepté), idéalement en re-dictant le contenu du 11h34 dont il connaît le texte voulu. Piste pour 016/017 : offrir une rétention d'audio locale (opt-in) pour rendre les futurs bake-offs/debugs rejouables.

## Résolution (2026-08-07)

Bake-off exécuté sur **2 vraies dictées de Caleb** (re-dictée du message halluciné de 11h34, ~2,5 min ; dictée « code » ~1,5 min), enregistrées à l'Enregistreur vocal Windows (.m4a), 4 moteurs, hints = les 21 termes du vrai dictionnaire, jugement à l'aveugle. Assets : [015-bakeoff/](../assets/015-bakeoff/) (transcriptions, audios, mapping).

**Gagnant : `openai/gpt-transcribe` — 1er sur les deux dictées** (classement Caleb : C puis B / B puis A). Ponctuation propre, aucune invention, et les hints portent : « Groq », « OpenRouter », « Cursor » (terme du dictionnaire) tous corrects. **2e les deux fois : `mistralai/voxtral-mini-transcribe`** — très bon contenu (Grok/OpenRouter corrects), quelques collages de phrases, mais nettement plus rapide (50 s vs 81 s sur la longue) et ~40 % moins cher.

Éliminés par l'épreuve : **`deepgram/nova-3`** (transcription vide sur la longue, fragment anglais hors-sujet sur la courte — passthrough `language:multi`/keyterm probablement non fonctionnel via OpenRouter) ; **`whisper-large-v3`** non chunké (le baseline) a reproduit la signature exacte du défaut : « l'API de Croc », « OpenHooter », « J'ai pété real time », et un « Allez, bouc ! » inventé en fin de dictée.

Chiffres pour la décision 016 : latence gpt-transcribe ~81 s sur 2,5 min (voxtral ~50 s) — nettement plus lent que Groq actuel (quelques s) ; coût ~$0.011 la dictée longue (~$0.007 voxtral), négligeable au volume de Caleb. Voxtral reste le repli vitesse/prix si la latence du gagnant gêne à l'usage.

## Harnais

**État du harnais (2026-08-07) :** écrit et validé en fumée — `scratchpad/bakeoff/harness.ts` (bun), voie base64 JSON, 4 moteurs (shortlist + `openai/whisper-large-v3` non chunké comme proxy du pipeline actuel), hints = les 21 termes du vrai dictionnaire de Caleb extraits de la DB, latence + `usage.cost` mesurés, sorties à l'aveugle (A/B/C/D + `mapping.json`). Test sur 20 s de tonalité + silences : les 4 appels passent (HTTP 200, coûts réels ~$0.001–0.0015) et — signature du défaut chassé — **whisper-large-v3 est le seul à halluciner (« oui ») sur un audio sans parole**, les trois moteurs de la shortlist rendent vide.
