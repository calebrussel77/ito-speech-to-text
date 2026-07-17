---
id: 010
title: "Recherche : optimiser Groq au maximum (modèles, coûts réels, leviers de fidélité)"
label: wayfinder:research
mode: AFK
status: closed
assignee: claude (subagent /research)
blocked-by: []
resolved: 2026-07-17
---

## Question

Groq est la voie par défaut de la stratégie coût d'abord (révision du 2026-07-17). Ito utilise aujourd'hui `whisper-large-v3` sans paramètre de langue, avec le dictionnaire injecté en prompt ≤224 tokens. Qu'est-ce qu'on laisse sur la table ? Modèles actuels, coûts réels/free tier, leviers de fidélité, faiblesses connues, streaming, économie de routage vs AssemblyAI.

## Résolution (2026-07-17, recherche sur doc officielle Groq + sources communautaires)

### Question de gating : « le free tier Groq tient-il l'usage quotidien de Caleb ? » → **OUI, avec ~8x de marge.**

Free tier audio : 20 req/min, 2 000 req/jour, **28 800 audio-secondes/jour (= 8 h/jour)** — Caleb en consomme 0,5-1 h/jour (6-12 % du plafond). Même en payant : 15-30 h/mois = **1,67-3,33 $/mois** (large-v3 à $0.111/h). — https://console.groq.com/docs/rate-limits, https://groq.com/pricing

### 1. Modèles (juillet 2026)
- Deux modèles ASR seulement : `whisper-large-v3` ($0.111/h, WER moyen 10,3 %) et `whisper-large-v3-turbo` ($0.04/h, WER ~12 %). `distil-whisper` est mort (23/08/2025). Pas de nouveau modèle ASR Groq à mi-2026. — https://console.groq.com/docs/speech-to-text, https://console.groq.com/docs/deprecations
- Pour la dictée où chaque mot compte : **rester sur large-v3** (l'écart de coût est sans objet en free tier).
- Précédent de dépréciation à 2 mois de préavis → nom de modèle en config, pas en dur.

### 2. Coûts — deux astérisques
- **Minimum 10 s facturé par requête** (un clip de 5 s = 10 s facturées) — sans impact en free tier. — https://console.groq.com/docs/speech-to-text
- Fichier max 25 MB en free tier (un WAV 16 kHz de 2 min ≈ 3,8 MB — ok).

### 3. Leviers de fidélité (ce qu'Ito laisse sur la table)
- **`language: 'fr'` à ajouter** — doc Groq verbatim : « will improve accuracy and latency ». Risque connu : sur une dictée 100 % anglaise avec `fr` forcé, Whisper peut **traduire au lieu de transcrire** (20-50 % des cas rapportés) ; le profil de Caleb (FR majoritaire, termes anglais intra-phrase) fait de `fr` le bon défaut. — https://console.groq.com/docs/speech-to-text, https://github.com/openai/whisper/discussions/2285
- **Prompt 224 tokens** : n'influence que style/contexte, pas des instructions → l'écrire **en français, ponctué et accentué**, avec le lexique dev mêlé dedans (« J'utilise TypeScript, Electron, gRPC… ») — la langue et le style du prompt tirent la sortie vers du FR bien ponctué. — https://console.groq.com/docs/speech-to-text
- **`temperature: 0`** explicite (déterminisme, moins d'hallucinations).
- **`verbose_json` sous-exploité** : `avg_logprob`, `no_speech_prob`, `compression_ratio` par segment déjà reçus → filtrage anti-hallucination quasi gratuit (Ito ne vérifie que le premier segment aujourd'hui). Seuils de référence : no_speech 0,6 (agressif : 0,2 / logprob −0,5 / compression 2,4).
- **Prétraitement actuel (DC-offset, high-pass, normalisation) : à garder tel quel** — c'est le débruitage agressif/neuronal qui augmente le WER, pas ça. Ne pas ajouter de denoiser. — https://arxiv.org/html/2603.04710v1

### 4. Faiblesses whisper-large-v3 et mitigations
- FR spontané : ~8-12 % WER réel (les fine-tunes FR montrent 2-4 points de marge non atteignables sur API).
- Code-switching : non conçu pour ; détection de langue sur les 30 premières secondes, langue supposée unique.
- **Hallucinations sur silence** (« Sous-titres réalisés par la communauté d'Amara.org »…) : mitiger par VAD côté client (trim des silences avant envoi, garder les pauses < 1,5 s qui portent la ponctuation), durée minimale ~1 s de parole utile, et filtrage par segment (cf. §3). — https://arxiv.org/pdf/2501.11378, https://github.com/OpenWhispr/openwhispr/issues/462

### 5. Streaming
- **Groq n'a aucun endpoint streaming ASR** — batch fichier uniquement. La vitesse 200x+ donne ~0,3-1 s de latence perçue par clip, mais pas de texte partiel pendant l'enregistrement. — https://console.groq.com/docs/speech-to-text

### 6. Économie de routage
- **Règle simple : tout sur Groq free tier.** Même le pire cas payé Groq (3,3 $/mois) est sous l'option AssemblyAI la moins chère.
- AssemblyAI ne se justifie que pour : (a) le **streaming** (texte live — impossible sur Groq), avec ouverture/fermeture stricte du WebSocket au push-to-talk ; (b) fallback sur 429 Groq (improbable à ce volume) ; (c) si son code-switching FR/EN s'avère meilleur — **non vérifié, testable avec les 50 $ de crédits (~333 h en universal-2)**.
- **Jamais le Sync API à $0.45/h** : 3-4x le prix pour un gain de latence que Groq batch fournit déjà quasi gratuitement.

### Divers
- Headers `x-ratelimit-*` et `retry-after` sur 429 → backoff propre côté Ito. Limites par organisation, pas par clé. — https://console.groq.com/docs/rate-limits
- Pas d'endpoint UE documenté chez Groq (vs AssemblyAI qui en a).

### Recommandations nettes
Ajouter `language: 'fr'` ; réécrire le prompt en français ponctué incluant le dictionnaire ; `temperature: 0` explicite ; filtrer les segments via no_speech_prob/avg_logprob ; garde-fou VAD/durée minimale avant envoi ; garder le prétraitement actuel sans denoiser ; backoff sur `retry-after` ; modèle en config. **Rester 100 % Groq free tier** ; AssemblyAI uniquement si le texte live (streaming) est voulu ou si son code-switching prouve sa supériorité à l'essai gratuit.
