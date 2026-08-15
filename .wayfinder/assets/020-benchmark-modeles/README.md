# Banc de mesure des modèles — 2026-08-14

Mesure de la vitesse et de la précision des 24 modèles du catalogue
(`lib/constants/modelCatalog.ts`), pour remplacer les chiffres publiés par les
fournisseurs — qui décrivent des benchmarks courts et anglophones, et se sont
révélés faux sur du français dicté.

## Rejouer

```bash
cd .wayfinder/assets/020-benchmark-modeles
npm i ffmpeg-static           # ou ffmpeg sur le PATH (scoop install ffmpeg)
ffmpeg -i ../015-bakeoff/enregistrement-code.m4a -ar 16000 -ac 1 -c:a pcm_s16le enregistrement-code.wav
ffmpeg -i ../015-bakeoff/enregistrement-feature-ito.m4a -ar 16000 -ac 1 -c:a pcm_s16le enregistrement-feature-ito.wav
GROQ_KEY=... OR_KEY=... node voice.mjs && node wer.mjs
GROQ_KEY=... OR_KEY=... node text.mjs
```

Coût total d'un passage complet : environ $0,15.

## Méthode

**Voix.** Les deux vraies dictées du bake-off 015 (79 s et 149 s), converties en
WAV 16 kHz mono — le format exact que `LocalAudioProcessor` produit, donc la
requête réelle de l'app. Deux mesures :

- `speed` = facteur temps réel (secondes d'audio par seconde d'horloge, réseau
  compris), donc un chiffre bout en bout et non le débit crête annoncé.
- `accuracy` = taux d'erreur de mots (distance de Levenshtein sur les mots,
  minuscules, ponctuation retirée, **accents conservés** : en français ils
  portent du sens, un moteur qui les perd est réellement moins bon).

**Référence de vérité.** La sortie `openai/gpt-transcribe` du bake-off du
2026-08-07, que Caleb a classée première à l'aveugle sur les deux
enregistrements. Ce n'est pas circulaire — le run d'aujourd'hui est comparé à
un run d'il y a une semaine, d'où les 1,5 % de gpt-transcribe et non 0 % — mais
gpt-transcribe reste avantagé. Les écarts entre les **autres** moteurs sont,
eux, pleinement comparables.

**Texte.** Médiane de 3 passages du vrai prompt du Mode Intelligent
(`shared-constants.js`) sur une vraie transcription. Métrique : tokens de sortie
par seconde, réseau compris.

## Résultats

### Voix — WER (plus bas = mieux)

| modèle | code (79 s) | feature (149 s) | vitesse |
| --- | --- | --- | --- |
| gpt-transcribe (OpenAI direct) | 1,6 % | 1,1 % | 3,2× |
| gpt-transcribe | 1,6 % | 1,5 % | 7,7× |
| gpt-4o-mini-transcribe (OpenAI direct) | 1,6 % | 2,2 % | 4,9× |
| qwen3-asr-flash | 3,3 % | 2,5 % | 5,3× |
| gpt-4o-transcribe | 3,3 % | 5,1 % | 7,9× |
| gpt-4o-transcribe (OpenAI direct) | 2,4 % | 5,1 % | 2,7× |
| voxtral-small-stt | 2,4 % | 6,5 % | 6,4× |
| whisper-large-v3-turbo (Groq) | 1,6 % | 7,6 % | 29,8× |
| voxtral-mini-transcribe | 4,1 % | 6,2 % | 10,6× |
| whisper-large-v3-turbo (OpenRouter) | 7,3 % | 12,7 % | 5,9× |
| nova-3 | 10,6 % | 11,6 % | 9,0× |
| **whisper-large-v3** | **8,9 %** | **82,9 %** | 24,4× |
| gpt-4o-transcribe-diarize (sur m4a) | 8,1 % | 17,1 % | 1,5× |
| **gpt-4o-transcribe-diarize (sur WAV 16 kHz)** | **74,0 %** | **42,9 %** | 1,6× |
| chirp-3 | HTTP 400 | HTTP 400 | — |

### Texte — tokens/seconde (médiane de 3)

gpt-oss-120b@Cerebras 1704 · qwen3.7-flash 862 · glm-4.7-flash 584 ·
qwen3.6-27b 392 · gpt-5.6-luna 363 · gpt-oss-120b@Groq 348 · gpt-5.4-nano 344 ·
gpt-oss-20b@Groq 309 · gemma-4-31b@Cerebras 165 · claude-sonnet-5 145 ·
gemini-3.7-flash 118 · mistral-nemo 99 · gemini-3.5-flash-lite 66 ·
claude-haiku-4.5 60 · gemini-2.5-flash-lite 20

## Ce que ça a changé

1. **`whisper-large-v3` n'est plus le défaut.** Il dégénère : sur la dictée de
   149 s il part en boucle et récite le prompt qu'on lui a donné
   (« Français courant avec termes anglais de programmation », six fois), puis
   termine sur « Sous-titrage Société Radio-Canada ». Vérifié aussi sur un
   extrait de **40 s**, donc sous le seuil du mode long : il invente
   « Fremont-France, le code de la technique de la technologie est-il
   suffisant… » là où turbo transcrit correctement. Le défaut passe à
   `whisper-large-v3-turbo`, meilleur sur les deux durées, 1,5× plus rapide et
   3× moins cher. Migration `2026-08-14-whisper-turbo-default`.

2. **`chirp-3` est retiré du catalogue.** Plafond dur de 60 s (limite de
   reconnaissance synchrone de Google) : il passe à 55 s, échoue à 65 s. Or le
   créneau OpenRouter ne sert que les dictées ≥ 60 s — il aurait échoué à 100 %
   des requêtes qu'on lui aurait confiées. C'était en plus le plus cher du
   tableau, à $0,96/h.

3. **`qwen3-asr-flash` est la bonne surprise** : 2,5 % de WER sur la longue,
   deuxième derrière gpt-transcribe, à $0,13/h contre $0,27/h.

4. **L'épinglage Cerebras est spectaculaire** : le même `gpt-oss-120b` rend
   1704 tok/s via Cerebras contre 348 chez Groq, soit 5×.

## Run du 2026-08-15 — OpenAI en direct

Les quatre modèles OpenAI servis en direct (`openai-voice.mjs`, clé de Caleb),
même protocole. Deux constats :

1. **OpenAI en direct est ~2,5× plus lent que les mêmes modèles via
   OpenRouter**, à précision égale (gpt-transcribe : 3,2× temps réel en direct
   contre 7,7× revendus). Les gauges `speed` des entrées `-openai` du
   catalogue sont donc à 1 là où leurs jumelles OpenRouter sont à 2.
2. **`gpt-4o-transcribe-diarize` déraille sur le WAV 16 kHz mono** : il part en
   code-switching et TRADUIT des passages entiers en anglais (74 % de WER sur
   le clip code). Sur les m4a originaux — le payload réel de son seul usage,
   le fichier importé — il reste en français (8,1 % / 17,1 %). Ses gauges sont
   mesurées sur m4a (`diarize-m4a-results.json`), et c'est une raison de plus
   de le garder `fileOnly` : la dictée en direct enverrait précisément le
   WAV 16 kHz qui le fait dérailler.

## Limite connue

Aucun échantillon franchement court (< 40 s) n'existe dans les assets. Les
jauges du créneau « dictée courte » reposent donc sur 79 s et sur un extrait de
40 s. Si le comportement en dessous de 20 s devenait un sujet, il faudrait
enregistrer un échantillon dédié.
