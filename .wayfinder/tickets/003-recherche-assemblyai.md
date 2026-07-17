---
id: 003
title: "Recherche : capacités AssemblyAI pour le profil Ito"
label: wayfinder:research
mode: AFK
status: closed
assignee: claude (subagent /research)
blocked-by: []
resolved: 2026-07-17
---

## Question

L'API AssemblyAI couvre-t-elle le profil d'usage d'Ito (français courant, code-switching FR/EN, vocabulaire technique, longues dictées) ? À établir, avec sources :

1. **Streaming temps réel** (Universal-Streaming) : langues supportées aujourd'hui — le français en fait-il partie et à quelle qualité ? Code-switching FR/EN ? Latence typique ? Formats d'entrée acceptés (PCM 16-bit 16 kHz mono — ce qu'Ito produit — est-il ok ?) ? Modèle d'auth pour un client desktop (clé API directe vs tokens temporaires) ?
2. **Batch/async** : exactitude FR vs whisper-large-v3, ponctuation/formatage automatiques, latence de traitement pour des clips de 5 s à 2 min.
3. **Vocabulaire custom** : word boost / keyterms — limites, pour remplacer l'injection actuelle du dictionnaire en prompt ≤224 tokens.
4. **Prix** des deux voies pour un usage dictée quotidienne (~30-60 min d'audio/jour).
5. **SDK JS/Node** utilisable depuis un main process Electron.
6. **LeMUR** : pertinent pour remplacer le post-traitement LLM du mode EDIT ?

## Résolution (2026-07-17, recherche sur doc officielle AssemblyAI)

### Question de blocage : « le streaming AssemblyAI supporte-t-il bien le français ? » → **OUI, clairement.**

Deux modèles streaming supportent le français, sans mention beta, avec code-switching natif intra-phrase :
- **Universal-Streaming Multilingual** (en/es/fr/de/it/pt, modèle unifié, `"speech_model": "universal-streaming-multilingual"` sur `wss://streaming.assemblyai.com/v3/ws`) — https://www.assemblyai.com/blog/introducing-multilingual-universal-streaming
- **Universal-3.5 Pro Realtime** (`universal-3-5-pro`, 18 langues dont FR, « native code switching ») — https://www.assemblyai.com/docs/faq/language-support-for-real-time-transcription

### 1. Streaming
- Code-switching FR/EN natif sur le modèle multilingue (espace d'embedding partagé, bascule en milieu de phrase sans config) — le profil exact d'Ito.
- Latence P50 = **303 ms** (multilingue) ; ponctuation/casse intégrées à la sortie du modèle.
- Format : « mono 16-bit PCM, `sample_rate` 16 kHz » — **exactement le format actuel d'Ito**. Opus aussi accepté. — https://www.assemblyai.com/docs/speech-to-text/universal-streaming
- Auth : header `Authorization`, ou **tokens temporaires** (`client.streaming.createTemporaryToken({ expires_in_seconds: 60 })`) — la doc déconseille d'embarquer la clé côté client distribué.
- **Piège de facturation push-to-talk** : le streaming est facturé sur la **durée d'ouverture du WebSocket**, pas l'audio envoyé ; session non fermée auto-close à 3 h et facturée en entier → ouvrir/fermer la socket avec l'appui/relâche. — https://www.assemblyai.com/docs/faq/how-does-universal-streaming-session-based-pricing-work

### 2. Batch/async
- Modèles actuels : `universal-3-pro` (U3.5 Pro, $0.21/h) et `universal-2` ($0.15/h). **`slam-1`, `best`, `nano` sont dépréciés** — toute doc antérieure les mentionnant est obsolète. — https://www.assemblyai.com/pricing
- FR : U3.5 Pro supporte `fr` (dialectes métropolitain/québécois/belge auto) ; Universal-2 : FR dans les langues « highest accuracy », WER ≤ 10 %. — https://www.assemblyai.com/docs/speech-to-text/pre-recorded-audio/supported-languages
- **Découverte majeure — Sync API** : endpoint synchrone pour clips **< 2 min** : un POST, transcript U3.5 Pro en **~134 ms P50**, sans polling. Quasi le cas d'usage exact d'Ito. $0.45/h. — https://www.assemblyai.com/products/sync-speech-to-text

### 3. Vocabulaire custom (keyterms)
- Batch U3 Pro : jusqu'à **1 000 termes** via `keyterms_prompt`, **français couvert**. — https://www.assemblyai.com/docs/pre-recorded-audio/keyterms-prompting
- Streaming Universal-Streaming : ≤ **100 termes** de ≤ 50 caractères. Streaming U3 Pro : 1 000 termes, add-on $0.05/h, mise à jour dynamique en session. — https://www.assemblyai.com/blog/streaming-keyterms-prompting, https://www.assemblyai.com/docs/streaming/universal-3-pro/prompting
- **Incertitude à tester** : keyterms en français non explicitement confirmé sur le modèle streaming multilingue à $0.15/h (couvert sur u3-rt-pro).

### 4. Prix (profil ~15-30 h/mois) — https://www.assemblyai.com/pricing
| Voie | Tarif | 15 h/mois | 30 h/mois |
|---|---|---|---|
| Streaming Universal-Streaming (multilingue FR) | $0.15/h | $2.25 | $4.50 |
| Streaming U3.5 Pro Realtime | $0.45/h | $6.75 | $13.50 |
| Batch Universal-2 | $0.15/h | $2.25 | $4.50 |
| Batch U3.5 Pro | $0.21/h | $3.15 | $6.30 |
| Sync API (< 2 min) | $0.45/h | $6.75 | $13.50 |

- Batch facturé à la seconde, sans minimum ; échecs non facturés. **Gratuit : $50 de crédits sans carte bancaire** ; free tier limité à **5 nouveaux streams/minute** (attention en tests push-to-talk rapprochés), 100/min en pay-as-you-go.

### 5. SDK Node (`assemblyai` npm)
- v4.36.3 (13 juillet 2026), TypeScript, activement maintenu. Streaming via `client.streaming.transcriber(...)` (événements open/turn/close/error). `client.sync.transcribe` accepte **PCM brut**/buffers — se branche directement sur le pipeline d'Ito. Node-first : le main process Electron est le cas nominal. — https://github.com/AssemblyAI/assemblyai-node-sdk

### 6. LeMUR
- **Mort : arrêté au 31 mars 2026.** Remplaçant : **LLM Gateway** — API compatible OpenAI, 25+ modèles, zéro markup, option zéro rétention. Fonctionnellement équivalent à un appel LLM direct (une seule clé/facture AssemblyAI en avantage). — https://www.assemblyai.com/docs/llm-gateway/migration-from-lemur

### Divers matériel
- **Résidence UE** : `api.eu.assemblyai.com` / `streaming.eu.assemblyai.com` (Dublin) ; l'endpoint streaming par défaut route vers la région la plus proche (Oregon/Virginie/Stockholm) — pertinent latence/RGPD depuis l'Afrique francophone/Europe. — https://www.assemblyai.com/docs/streaming/endpoints-and-data-zones

### Verdict pour Ito
Profil entièrement couvert : FR quotidien (GA streaming + batch, dialectes inclus), code-switching FR/EN natif intra-phrase, vocabulaire technique via keyterms (1 000 termes FR sur U3 Pro), ponctuation/casse intégrées. **Deux architectures viables** : streaming multilingue $0.15/h (~$2-5/mois, texte au fil de l'eau, P50 303 ms) ou **Sync API** $0.45/h (~$7-14/mois, ~134 ms par clip, changement minimal depuis le batch Groq actuel). Vigilance : fermeture stricte des WebSockets (facturation au temps de session), 5 streams/min en free tier, keyterms FR à tester sur le modèle $0.15/h, LeMUR mort → LLM Gateway.
