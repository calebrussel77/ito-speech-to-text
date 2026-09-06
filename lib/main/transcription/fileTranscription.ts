import fs from 'fs'
import { deepgramTranscriptionService } from './DeepgramTranscriptionService'
import { googleTranscriptionService } from './GoogleTranscriptionService'
import { openaiTranscriptionService } from './OpenAITranscriptionService'
import { openRouterAudioService } from './OpenRouterAudioService'
import {
  inferSpeakersFromText,
  polishDialogue,
  polishPlainText,
} from './dialoguePolish'
import { interactionManager } from '../interactions/InteractionManager'
import { resolveActiveMode } from '../modes/activeMode'
import { getAdvancedSettings, type AdvancedSettings } from '../store'
import { asrLanguageHint } from '../../constants/modeLanguages'
import { findModel, type CatalogModel } from '../../constants/modelCatalog'
import {
  collapseMinorSpeakers,
  formatSpeakerTranscript,
} from '../../transcription/speakerTranscript'
import { contextGrabber } from '../context/ContextGrabber'
import { prepareUploadAudio } from '../audio/transcodeForUpload'
import type { SpeakerSegment } from './DeepgramTranscriptionService'

type FileProvider = 'deepgram' | 'openrouter' | 'google' | 'openai'

/** Le modèle multimodal par défaut chez OpenRouter, quand aucun n'est choisi. */
const DEFAULT_OPENROUTER_AUDIO_KEY = 'gemini-3-7-flash-openrouter-audio'

/**
 * Traite un enregistrement fait ailleurs (Teams, OBS, un dictaphone, un
 * appel de prospection enregistré au téléphone).
 *
 * C'est le filet du mode Meeting : la première réunion qu'on veut résumer est
 * toujours celle qu'on a oublié de lancer dans Ito. Le fichier n'est jamais
 * touché — on le lit, on l'envoie, et on ne le déplace ni ne le supprime.
 *
 * **Aucun mode ne s'applique ici, et c'est délibéré.** Ce chemin passait par le
 * mode actif : importer l'enregistrement d'une réunion pendant que le mode
 * Meeting était actif faisait réécrire le transcript par ses instructions, qui
 * sont écrites pour une dictée en direct — le résultat n'avait plus grand
 * rapport avec le fichier. Un fichier importé n'a pas d'intention : il a un
 * contenu. On le transcrit, on ne l'interprète pas.
 *
 * Ce que le fichier contient décide de la forme du résultat : plusieurs
 * voix, et le transcript est rendu en dialogue nommé et horodaté ; une seule,
 * et c'est le texte simple, sans étiquette « Speaker 1 » qui n'apprendrait
 * rien. Quel que soit le fournisseur, le pipeline est le même :
 *
 * 1. l'audio est allégé avant l'envoi (mono, 48 kbit/s) quand la machine
 *    sait le décoder — un m4a de réunion de 45 Mo en devient 17 ;
 * 2. le dictionnaire de l'utilisateur sert de vocabulaire au moteur ;
 * 3. les voix marginales (un « oui » de fond, un bruit de micro) sont
 *    rendues à leur voisin avant de compter les locuteurs ;
 * 4. un transcript d'ASR (Deepgram, OpenAI) est relu par le modèle texte,
 *    qui corrige les mots mal entendus, les noms et la ponctuation sans
 *    toucher au reste — un modèle multimodal (Gemini) l'a déjà fait en
 *    écoutant l'audio avec le même brief.
 *
 * Seule chose empruntée au mode actif : **la langue parlée**. Elle décrit
 * l'utilisateur, pas le traitement.
 *
 * Le fournisseur vient de Models → « Imported file transcription ». Sans
 * choix explicite : Deepgram si sa clé est là, sinon Gemini via OpenRouter,
 * sinon Google, sinon OpenAI — dans l'ordre de ce que l'utilisateur a le
 * plus probablement configuré.
 */
export async function transcribeExistingFile(filePath: string): Promise<{
  ok: boolean
  interactionId?: string
  speakerCount?: number
  error?: string
}> {
  if (!fs.existsSync(filePath)) {
    return { ok: false, error: 'File not found' }
  }

  const advancedSettings = getAdvancedSettings()
  const route = chooseFileProvider(advancedSettings)
  if ('error' in route) return { ok: false, error: route.error }
  const { provider, model } = route

  const startedAt = performance.now()
  try {
    const activeMode = await resolveActiveMode()
    const language = asrLanguageHint(activeMode.language)
    const original = fs.readFileSync(filePath)
    // Le dictionnaire est la seule chose que l'utilisateur ait dite sur son
    // vocabulaire : noms de produits, de clients, d'outils. Il vaut pour un
    // appel de prospection autant que pour une dictée.
    const { vocabularyWords } = await contextGrabber.getVocabulary()

    const upload = await prepareUploadAudio(filePath, original)
    if (upload.transcoded) {
      console.log(
        `[fileTranscription] ${upload.fileName}: ${original.length} -> ${upload.bytes.length} bytes before upload`,
      )
    }
    const audioFormat = upload.contentType === 'audio/wav' ? 'wav' : 'mp3'

    const asrStartedAt = performance.now()
    const { text, segments: rawSegments } =
      provider === 'google'
        ? await googleTranscriptionService.transcribeAudio(upload.bytes, {
            apiKey: advancedSettings.googleApiKey!,
            model: model!.slug,
            language,
            diarize: true,
            contentType: upload.contentType,
            displayName: upload.fileName,
            vocabulary: vocabularyWords,
            thinking: 'low',
          })
        : provider === 'openrouter'
          ? await openRouterAudioService.transcribeAudio(upload.bytes, {
              apiKey: advancedSettings.openRouterApiKey!,
              model: model!.slug,
              language,
              vocabulary: vocabularyWords,
              format: audioFormat,
            })
          : provider === 'openai'
            ? await openaiTranscriptionService.transcribeAudio(upload.bytes, {
                apiKey: advancedSettings.openaiApiKey!,
                model: model!.slug,
                language,
                diarize: true,
                contentType: upload.contentType,
                fileName: upload.fileName,
                vocabulary: vocabularyWords,
              })
            : await deepgramTranscriptionService.transcribeAudio(upload.bytes, {
                apiKey: advancedSettings.deepgramApiKey!,
                model: 'nova-3',
                language,
                diarize: true,
                contentType: upload.contentType,
              })
    const asrMs = Math.round(performance.now() - asrStartedAt)

    // Un ASR qui diarise (Deepgram, OpenAI) coupe volontiers une voix en
    // deux ou attribue un « oui » de fond à un tiers ; un modèle multimodal
    // étiquette un bruit de micro comme une personne. Ces miettes sont
    // rendues au locuteur voisin avant de compter les voix.
    let segments = collapseMinorSpeakers(rawSegments ?? [])
    const heardOnly = provider === 'deepgram' || provider === 'openai'
    const polishStartedAt = performance.now()

    // Le moteur n'a pas séparé les voix (gpt-transcribe, Whisper, ou une
    // diarisation qui n'a rien trouvé) : le modèle texte relit le transcript
    // à plat et le structure en dialogue s'il reconnaît une conversation —
    // en corrigeant les mots mal entendus au passage.
    let inferred: { text: string } | null = null
    if (
      heardOnly &&
      segments.length === 0 &&
      text.split(/\s+/).filter(Boolean).length >= 60
    ) {
      const result = await inferSpeakersFromText(
        text,
        { vocabulary: vocabularyWords, language },
        advancedSettings,
      )
      if (result.isConversation) segments = result.segments
      inferred = result
    }

    const speakerCount = new Set(segments.map(s => s.speaker)).size
    const isConversation = speakerCount >= 2 && segments.length > 0

    // Relecture par le modèle texte, pour les moteurs qui n'ont fait
    // qu'entendre. Gemini a déjà reçu le brief et le vocabulaire ; un
    // transcript structuré ci-dessus a déjà été relu dans le même passage.
    const polishedSegments =
      heardOnly && isConversation && !inferred
        ? await polishDialogue(segments, vocabularyWords, advancedSettings)
        : segments
    const polishedText = inferred
      ? inferred.text
      : heardOnly && !isConversation
        ? await polishPlainText(text, vocabularyWords, advancedSettings)
        : text
    const polishMs = heardOnly
      ? Math.round(performance.now() - polishStartedAt)
      : 0

    const finalText = isConversation
      ? formatSpeakerTranscript(polishedSegments)
      : polishedText
    const rawText =
      isConversation && !inferred ? formatSpeakerTranscript(segments) : text

    const engine = engineName(provider, model)
    const interactionId = await interactionManager.createRecoveredInteraction(
      finalText,
      16000,
      null,
      undefined,
      engine,
      {
        rawTranscript: rawText,
        // Aucun mode n'a traité ce fichier : lui en attribuer un ferait
        // remonter dans l'historique une ligne « dictée en mode X » qui n'a
        // jamais eu lieu.
        speakers: isConversation ? polishedSegments : undefined,
        latency: {
          asrMs,
          adjustMs: polishMs,
          totalMs: Math.round(performance.now() - startedAt),
          uploadBytes: upload.bytes.length,
        },
      },
    )

    // `createRecoveredInteraction` avale ses propres erreurs de base de
    // données et rend `undefined` plutôt que de lever : un identifiant
    // manquant EST l'échec — sans quoi une écriture ratée après une
    // transcription de plusieurs minutes se rapporterait comme un succès.
    if (!interactionId) {
      console.error(
        `[fileTranscription] Transcribed ${filePath} but failed to save it to history`,
      )
      return {
        ok: false,
        error: 'Transcribed the file, but saving it to history failed.',
      }
    }

    console.log(
      `[fileTranscription] Transcribed ${filePath} with ${engine} in ${Math.round((performance.now() - startedAt) / 1000)} s — ${
        isConversation ? `${speakerCount} speakers` : 'single speaker'
      }`,
    )
    return { ok: true, interactionId, speakerCount }
  } catch (error: any) {
    console.error('[fileTranscription] Failed:', error?.message || error)
    return { ok: false, error: error?.message || 'Transcription failed' }
  }
}

/**
 * Le fournisseur et le modèle d'un import, d'après le réglage et les clés
 * présentes. Un réglage qui désigne un fournisseur sans clé est une erreur
 * explicite, qui nomme le modèle ; sans réglage, le premier fournisseur
 * dont la clé existe prend le fichier.
 */
export function chooseFileProvider(
  advancedSettings: AdvancedSettings,
): { provider: FileProvider; model?: CatalogModel } | { error: string } {
  const keys: Record<FileProvider, string | undefined> = {
    deepgram: advancedSettings.deepgramApiKey?.trim(),
    openrouter: advancedSettings.openRouterApiKey?.trim(),
    google: advancedSettings.googleApiKey?.trim(),
    openai: advancedSettings.openaiApiKey?.trim(),
  }
  const keyLabel: Record<FileProvider, string> = {
    deepgram: 'Deepgram',
    openrouter: 'OpenRouter',
    google: 'Google',
    openai: 'OpenAI',
  }

  // `findModel` rend `undefined` sur une clé disparue du catalogue : on
  // retombe alors sur le choix automatique plutôt que de refuser un fichier
  // à cause d'un réglage périmé.
  const chosen = advancedSettings.fileTranscriptionModelKey
    ? findModel(advancedSettings.fileTranscriptionModelKey)
    : undefined
  if (chosen) {
    const provider = chosen.provider as FileProvider
    if (!keys[provider]) {
      return {
        error: `${chosen.label} needs a${provider === 'openai' || provider === 'openrouter' ? 'n' : ''} ${keyLabel[provider]} API key. Add one in Models.`,
      }
    }
    return { provider, model: chosen }
  }

  if (keys.deepgram) return { provider: 'deepgram' }
  if (keys.openrouter) {
    return {
      provider: 'openrouter',
      model: findModel(DEFAULT_OPENROUTER_AUDIO_KEY),
    }
  }
  if (keys.google) {
    return { provider: 'google', model: findModel('gemini-3-7-flash-audio') }
  }
  if (keys.openai) {
    return {
      provider: 'openai',
      model: findModel('gpt-4o-transcribe-diarize-openai'),
    }
  }
  return {
    error:
      'Transcribing an imported file needs a Deepgram, OpenRouter, Google or OpenAI API key. Add one in Models.',
  }
}

/**
 * Ce que l'historique affiche. Le slug OpenAI est stocké nu : `EngineBadge`
 * retrouve alors l'entrée `provider: 'openai'` du catalogue. Les modèles
 * servis par OpenRouter sont préfixés pour ne pas être confondus avec le
 * même modèle servi par Google directement.
 */
function engineName(provider: FileProvider, model?: CatalogModel): string {
  if (provider === 'deepgram') return 'deepgram/nova-3'
  if (provider === 'google') return `google/${model?.slug}`
  if (provider === 'openrouter') return `openrouter/${model?.slug}`
  return model?.slug ?? 'openai'
}

export type { SpeakerSegment }
