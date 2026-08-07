# 014 — Shortlist des moteurs de transcription longue durée (OpenRouter)

> Recherche documentaire du 2026-08-07, sur la base du snapshot [openrouter-transcription-models-2026-08-07.json](openrouter-transcription-models-2026-08-07.json) (14 modèles).
> Profil : français courant, code-switching FR/EN, vocabulaire technique dev, dictées 1–10 min, ~20–40 min/jour.
> Priorité : précision > vitesse > coût. Aucune clé API dans ce fichier — le harnais lit `$OPENROUTER_API_KEY`.

## Shortlist

### 1. `mistralai/voxtral-mini-transcribe` — le favori précision FR

Voxtral Mini Transcribe 2 (slug canonique `voxtral-mini-transcribe-2602`) affiche ~4 % de WER moyen
sur FLEURS top-10 langues (~5,9 % sur l'ensemble, contre ~7,4–10,3 % pour Whisper large-v3 selon les
sources), et Mistral suit spécifiquement le français dans ses évals (le papier Voxtral mentionne la
sensibilité du WER FR au padding). Il supporte le **context biasing jusqu'à 100 termes**
(`context_bias`) — le dictionnaire d'Ito — avec le bémol que Mistral le déclare « optimisé anglais,
expérimental autres langues ». Rapide (~3 s par minute d'audio mesuré sur Voxtral Mini 3B), jusqu'à
3 h d'audio par requête côté Mistral, et le moins cher du haut de gamme : **$0.003/min**.

### 2. `openai/gpt-transcribe` — les hints les plus riches, taillé pour le code-switching

Sorti fin juillet 2026 en remplacement officiel de whisper-1. C'est le seul moteur qui accepte
**trois canaux de contexte distincts** : `prompt` (contexte libre : « dictée technique dev, FR avec
termes anglais »), `keywords` (termes littéraux — le dictionnaire Ito, avec la garantie documentée
« hints, not required output », donc faible risque d'injection de termes non prononcés), et
`languages` **au pluriel** (`["fr","en"]` = déclaration explicite du code-switching, unique sur le
marché). WER Common Voice 22 langues : 19,27 % contre 40,37 % pour whisper-1 (−52 %). **$0.0045/min**.
Bémols : latence long-fichier non documentée (à mesurer au bake-off), pas de timestamps mots ni SRT.

### 3. `deepgram/nova-3` — le filet de sécurité vitesse + keyterms multilingues

Nova-3 Multilingual gère nativement le **code-switching entre 10 langues dont FR/EN** dans un même
audio, et le **Keyterm Prompting est désormais multilingue** (jusqu'à 100 termes, appliqué à
l'inférence). Le batch Deepgram est réputé le plus rapide du marché (largement sous le timeout 60 s
d'OpenRouter même pour 10 min). **from $0.0043/min**. Bémols : WER FR publié par Deepgram surtout en
relatif (vs Nova-2), moins vérifiable que FLEURS ; et le passage des `keyterm` via
`provider.options.deepgram` n'est pas documenté par OpenRouter — à confirmer empiriquement au
ticket 015 (le snapshot montre `supported_parameters: []` pour nova-3, signe que le passthrough est
la seule voie).

### Référence gratuite à battre : Groq `whisper-large-v3` chunké (existant)

Le pipeline actuel (découpage VAD ~60 s) reste le baseline du bake-off. Le chunking VAD est
précisément la mitigation standard documentée contre les hallucinations long-format de Whisper
(voir section Chunking).

### Écartés (et pourquoi)

- **Lignée Whisper via OpenRouter** (`openai/whisper-1`, `whisper-large-v3`, `whisper-large-v3-turbo`) :
  c'est le mode de défaillance qu'on fuit. Les hallucinations long-format de Whisper (boucles de
  répétition, « ghost transcripts » sur les silences) sont massivement documentées : phénomène
  décodeur autoregressif, aggravé par les silences et le report de contexte entre fenêtres de 30 s.
  Les prendre sans chunking VAD serait une régression vs Groq chunké ; avec chunking, autant garder
  Groq qui est gratuit.
- **`qwen/qwen3-asr-flash`** : l'outsider frustrant. Context biasing « format libre » natif, filtre
  silence/non-parole intégré (bon signe anti-hallucination), FR supporté, prix plancher
  ($0.000035/s ≈ $0.0021/min). Mais **cap dur de 3 min / 10 MB par requête** côté DashScope — il
  imposerait exactement le chunking qu'on cherche à éliminer. À revisiter si Alibaba expose
  `qwen3-asr-flash-filetrans` (asynchrone, audio long) via OpenRouter.
- **`google/chirp-3`** : cher ($0.016/min, ~4–5× Voxtral), pas de mécanisme de hints via cette API.
- **`nvidia/parakeet-tdt-0.6b-v3`** : très rapide et pas cher ($0.0015/min) mais 600M de paramètres,
  aucun hint, précision FR en retrait des gros modèles — candidat « vitesse » pas « précision ».
- **`microsoft/mai-transcribe-1.5`, `fish-audio/transcribe-1`, `x-ai/grok-stt-1.0`** : aucun
  benchmark FR publié trouvé, pas de hints documentés ; fish/grok sont des paris à l'aveugle malgré
  leurs prix ($0.0001/s, $0.10/h).
- **`openai/gpt-4o-transcribe` / `gpt-4o-mini-transcribe`** : rendus obsolètes par gpt-transcribe
  (OpenAI le positionne comme remplaçant, plus précis et moins cher que gpt-4o-transcribe à
  $0.006/min).

## Tableau comparatif

| | Voxtral Mini Transcribe | GPT Transcribe | Deepgram Nova-3 | (réf.) Groq whisper-v3 chunké |
|---|---|---|---|---|
| **Précision FR** | ~4 % WER FLEURS top-10 (meilleur chiffre publié) ; FR suivi explicitement par Mistral | −52 % WER vs whisper-1 (Common Voice 22 langues, 19,27 %) ; conçu pour accents/jargon/multilingue | Bonne (revendiquée vs Nova-2, préférence jusqu'à 8:1) mais chiffres absolus FR non publiés | Bonne par chunk de 60 s ; hallucinations éliminées par le VAD, pas par le modèle |
| **Hints / dictionnaire** | `context_bias` (≤100 termes) — FR « expérimental » | `prompt` libre + `keywords` + `languages:["fr","en"]` — le plus complet | `keyterm` multilingue (≤100 termes) — passthrough OpenRouter à vérifier | `prompt` Groq (~224 tokens) via `provider.options.groq` |
| **Code-switching FR/EN** | Implicite (13 langues) | Explicite via `languages` pluriel | Natif (mode multilingual, 10 langues) | Faible (whisper force souvent une langue par fenêtre) |
| **Latence attendue (10 min d'audio)** | ~30 s (mesure : ~3 s/min) — passe le timeout 60 s | Non documentée — à mesurer au bake-off (risque timeout si < 10× temps réel) | Quelques secondes (batch Deepgram, le plus rapide) | ~10–15 s (Groq très rapide) + overhead orchestration chunks |
| **Coût vérifié** | $0.003/min | $0.0045/min | from $0.0043/min | $0 (free tier) |
| **Projection 30 min/j × 30 j (900 min/mois)** | **$2.70/mois** | **$4.05/mois** | **$3.87/mois** | $0 |
| **Limites** | context_bias FR expérimental ; timestamps XOR `language` chez Mistral | Pas de timestamps mots/SRT ; latence inconnue ; modéré (`is_moderated: true`) | Passage des keyterms via OpenRouter non documenté ; `supported_parameters: []` | Hallucinations si le chunking casse ; qualité dépendante du VAD |

Unités de facturation vérifiées sur les pages OpenRouter : gpt-transcribe **$0.0045/minute**,
nova-3 **from $0.0043/minute**, voxtral **$0.003/minute**, qwen3-asr-flash **$0.000035/seconde**,
fish $0.0001/s, grok $0.10/h — les unités **varient par modèle**, ne jamais comparer les champs
`pricing.prompt` bruts du JSON entre eux. Le coût réel par requête est retourné dans `usage.cost`
(USD) : à logger dans le harnais pour trancher.

## Shape d'appel (harnais ticket 015)

Le `prompt` top-level d'OpenRouter est **ignoré** : tous les hints passent par
`provider.options.<slug>`, forwardés uniquement au provider matché. La voie JSON base64 est
recommandée (elle supporte proprement l'objet `provider` imbriqué et le « streaming offload » pour
les gros fichiers) ; le multipart (25 MB max) reste pour les tests rapides sans hints.
`response_format: verbose_json` ne marche qu'avec les providers OpenAI-compatibles (OpenAI, Groq,
Together) — rester en `json` pour Voxtral/Deepgram.

Préparer l'audio : `AUDIO_B64=$(base64 -w0 dictation.wav)` (WAV 16 kHz mono 16 bit ≈ 1,9 MB/min).

### 1. Voxtral Mini Transcribe

```bash
curl -s https://openrouter.ai/api/v1/audio/transcriptions \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d @- <<EOF
{
  "model": "mistralai/voxtral-mini-transcribe",
  "input_audio": { "data": "$AUDIO_B64", "format": "wav" },
  "language": "fr",
  "temperature": 0,
  "response_format": "json",
  "provider": {
    "options": {
      "mistral": {
        "context_bias": ["Ito", "OpenRouter", "electron-vite", "gRPC", "bun", "TypeScript", "push-to-talk", "AssemblyAI"]
      }
    }
  }
}
EOF
```

### 2. GPT Transcribe

```bash
curl -s https://openrouter.ai/api/v1/audio/transcriptions \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d @- <<EOF
{
  "model": "openai/gpt-transcribe",
  "input_audio": { "data": "$AUDIO_B64", "format": "wav" },
  "temperature": 0,
  "response_format": "json",
  "provider": {
    "options": {
      "openai": {
        "prompt": "Dictée technique d'un développeur francophone. Français courant avec termes anglais de programmation (code-switching FR/EN).",
        "keywords": ["Ito", "OpenRouter", "electron-vite", "gRPC", "bun", "TypeScript", "push-to-talk", "AssemblyAI"],
        "languages": ["fr", "en"]
      }
    }
  }
}
EOF
```

Note : pas de `language` top-level ici — gpt-transcribe utilise `languages` (pluriel) via les
options provider ; c'est le canal officiel pour déclarer le code-switching.

### 3. Deepgram Nova-3

```bash
curl -s https://openrouter.ai/api/v1/audio/transcriptions \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d @- <<EOF
{
  "model": "deepgram/nova-3",
  "input_audio": { "data": "$AUDIO_B64", "format": "wav" },
  "response_format": "json",
  "provider": {
    "options": {
      "deepgram": {
        "language": "multi",
        "keyterm": ["Ito", "OpenRouter", "electron-vite", "gRPC", "bun", "TypeScript", "push-to-talk", "AssemblyAI"]
      }
    }
  }
}
EOF
```

Notes : `language: "multi"` = mode multilingual code-switching de Deepgram (mettre `"fr"` pour
comparer le mode monolingue). Nova-3 n'a pas de `temperature`. Les slugs exacts des blocs
`provider.options` (`mistral`, `openai`, `deepgram`) sont à confirmer via
`GET /api/v1/models/<canonical_slug>/endpoints` (public) avant le bake-off — la doc OpenRouter ne
donne l'exemple que pour `groq` ; premier test du harnais : vérifier qu'un keyterm improbable du
dictionnaire ressort bien, sinon le passthrough ne fonctionne pas.

### Référence Groq (chunké, existant)

```bash
curl -s https://api.groq.com/openai/v1/audio/transcriptions \
  -H "Authorization: Bearer $GROQ_API_KEY" \
  -F "file=@chunk-000.wav" \
  -F "model=whisper-large-v3" \
  -F "language=fr" \
  -F "temperature=0" \
  -F "response_format=verbose_json"
```

## Chunking : faut-il chunker malgré tout ?

**Verdict : pour 1–10 min, non — c'est tout l'intérêt de la shortlist. Chunker au-delà de ~10 min.**

- **Timeout de traitement 60 s d'OpenRouter** : Voxtral (~3 s/min → ~30 s pour 10 min) et Nova-3
  (batch en secondes) passent confortablement. gpt-transcribe est l'inconnue — si le bake-off mesure
  > ~45 s sur 10 min, chunker gpt-transcribe à ~5 min. La doc OpenRouter dit explicitement « split
  long recordings » quand on approche du timeout.
- **Plafond 25 MB multipart** : WAV 16 kHz mono ≈ 1,9 MB/min → mur à ~13 min. Deux parades : la voie
  base64 JSON (« streaming offload », gère mieux les gros fichiers), ou compresser en OGG/Opus
  (~0,12 MB/min à 16 kbps voix, ~200 min sous 25 MB) — les deux formats sont acceptés
  (`wav|mp3|flac|m4a|ogg|webm|aac`).
- **Garde-fou produit** : cap dur côté Ito à ~10 min par requête (aligné sur le mode « enregistrement
  long » actuel) ; au-delà, découpe VAD aux silences et concaténation ordonnée — même mécanique que
  la référence Groq.

### Params recommandés pour la référence Groq chunké

Le chunking VAD est validé par la littérature comme LA mitigation des hallucinations Whisper
(« utterance splitting via a VAD is considered the most stable solution for clean chunking ») —
c'est aussi l'approche du toolkit officiel Qwen3-ASR (VAD + chunks ~120 s + appels parallèles) :

1. **Découpe aux silences (VAD), cible ~60 s, jamais en milieu de phrase** — les hallucinations
   naissent sur les silences et aux frontières arbitraires.
2. **Ne pas reporter le contexte/prompt d'un chunk au précédent à travers un long silence**
   (équivalent `condition_on_previous_text=false`) : le report de texte est le mécanisme des boucles
   auto-renforcées (« ghost transcripts »).
3. **`temperature=0`, `language=fr`** explicites sur chaque chunk.
4. **`response_format=verbose_json` + filtres par segment** : jeter les segments à `no_speech_prob`
   élevé (> ~0,6) ou `compression_ratio` anormal (> ~2,4) — signature des boucles de répétition.
5. **Paralléliser les chunks** (ils sont indépendants une fois le contexte non reporté) puis
   concaténer dans l'ordre — latence quasi plate quelle que soit la durée.

## Sources

- OpenRouter STT (endpoint, 25 MB, timeout 60 s, prompt ignoré, `provider.options`, `usage.cost`) : https://openrouter.ai/docs/guides/overview/multimodal/stt.md
- Pages modèles OpenRouter (unités de prix vérifiées) : https://openrouter.ai/openai/gpt-transcribe · https://openrouter.ai/deepgram/nova-3 · https://openrouter.ai/qwen/qwen3-asr-flash-2026-02-10
- GPT Transcribe (annonce, `prompt`/`keywords`/`languages`, WER −52 %) : https://developers.openai.com/api/docs/guides/transcription · https://alphasignal.ai/news/openai-replaces-whisper-with-gpt-transcribe-slashing-errors-by-52 · https://www.explainx.ai/blog/openai-gpt-live-transcribe-gpt-transcribe-july-2026 · https://x.com/OpenAIDevs/status/2082201169443905798
- Voxtral (FLEURS, prix, 3 h/requête, `context_bias`) : https://mistral.ai/news/voxtral/ · https://mistral.ai/news/voxtral-transcribe-2/ · https://arxiv.org/html/2507.13264v1 · https://docs.mistral.ai/studio-api/audio/speech_to_text/offline_transcription · https://weesperneonflow.ai/en/blog/2026-03-31-voxtral-whisper-open-source-speech-models-comparison-2026/ · https://www.f22labs.com/blogs/voxtral-mini-3b-vs-whisper-large-v3-which-ones-faster/
- Deepgram Nova-3 (FR, keyterm multilingue, code-switching 10 langues) : https://deepgram.com/learn/deepgram-expands-nova-3-with-spanish-french-and-portuguese-support · https://deepgram.com/learn/deepgram-expands-nova-3-with-10-new-languages-and-multilingual-keyterm-prompting · https://deepgram.com/learn/nova-3-multilingual-major-wer-improvements-across-languages · https://developers.deepgram.com/docs/models-languages-overview
- Qwen3-ASR-Flash (context biasing, cap 3 min/10 MB, toolkit VAD) : https://github.com/QwenLM/Qwen3-ASR-Toolkit · https://www.alibabacloud.com/help/en/model-studio/qwen-speech-recognition · https://www.marktechpost.com/2025/09/19/qwen3-asr-toolkit-an-advanced-open-source-python-command-line-toolkit-for-using-the-qwen-asr-api-beyond-the-3-minutes-10-mb-limit/
- Hallucinations Whisper long-format & mitigation VAD : https://github.com/ggml-org/whisper.cpp/issues/3744 · https://arxiv.org/html/2603.06193 (Whisper-CD) · https://github.com/openai/whisper/discussions/679 · https://dev.to/nareshipme/whisper-hallucination-on-silence-why-your-transcript-loops-the-same-phrase-2pg4 · https://github.com/OpenWhispr/openwhispr/issues/462 · https://arxiv.org/pdf/2311.00430 (Distil-Whisper, métriques 5-Dup./IER)
