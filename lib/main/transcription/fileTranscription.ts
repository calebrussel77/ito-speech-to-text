import fs from 'fs'
import { basename } from 'path'
import { deepgramTranscriptionService } from './DeepgramTranscriptionService'
import { googleTranscriptionService } from './GoogleTranscriptionService'
import { openaiTranscriptionService } from './OpenAITranscriptionService'
import { interactionManager } from '../interactions/InteractionManager'
import { resolveActiveMode } from '../modes/activeMode'
import { getAdvancedSettings } from '../store'
import { asrLanguageHint } from '../../constants/modeLanguages'
import { findModel } from '../../constants/modelCatalog'
import { formatSpeakerTranscript } from '../../transcription/speakerTranscript'

const CONTENT_TYPES: Record<string, string> = {
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  mp4: 'video/mp4',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  webm: 'audio/webm',
}

function contentTypeFor(filePath: string): string {
  const extension = filePath.split('.').pop()?.toLowerCase() ?? ''
  return CONTENT_TYPES[extension] ?? 'audio/wav'
}

/**
 * Traite un enregistrement fait ailleurs (Teams, OBS, un dictaphone).
 *
 * C'est le filet du mode Meeting : la première réunion qu'on veut résumer est
 * toujours celle qu'on a oublié de lancer dans Ito. Le fichier n'est jamais
 * touché — on le lit, on l'envoie tel quel à Deepgram avec le bon type MIME,
 * et on ne le déplace ni ne le supprime.
 *
 * **Aucun mode ne s'applique ici, et c'est délibéré.** Ce chemin passait par le
 * mode actif : importer l'enregistrement d'une réunion pendant que le mode
 * Meeting était actif faisait réécrire le transcript par ses instructions, qui
 * sont écrites pour une dictée en direct — le résultat n'avait plus grand
 * rapport avec le fichier. Un fichier importé n'a pas d'intention : il a un
 * contenu. On le transcrit, on ne l'interprète pas.
 *
 * Ce que le fichier contient décide donc de la forme du résultat : la
 * diarisation tourne toujours, et si elle trouve **plusieurs locuteurs** le
 * transcript est rendu nommé et horodaté, prêt à être relu ou donné à un mode
 * qui lit le presse-papier. Un seul locuteur — un mémo, un monologue — et c'est
 * le texte simple, sans étiquette « Speaker 1 » qui n'apprendrait rien.
 *
 * Seule chose empruntée au mode actif : **la langue parlée**. Elle décrit
 * l'utilisateur, pas le traitement, et sans indice `nova-3` retombe sur
 * l'anglais — ce qui casserait toutes les réunions françaises.
 *
 * Un fichier importé n'a pas été enregistré par Ito : pas de WAV, pas de
 * filet de récupération, donc pas de sens à emprunter les chemins courts
 * (Groq/OpenRouter) qu'utilise `chooseTranscriptionPath` pour une dictée en
 * direct. On l'exigeait déjà en pratique en forçant ses paramètres pour
 * qu'il ne rende que "Deepgram" ou un refus — mais ce refus recyclait le
 * message du routeur ("trop long"), qui mentait pour un mémo de dix
 * secondes : le vrai motif n'a jamais été la durée, faute de la connaître
 * sans décoder le fichier. On l'exprime donc directement ici : ce chemin
 * exige la clé du fournisseur choisi dans Models → « Imported file
 * transcription » — Deepgram par défaut, Google ou OpenAI si le réglage
 * désigne un de leurs modèles.
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

  // Le modèle choisi pour ce chemin, ou Deepgram comme avant. `findModel`
  // rend `undefined` sur une clé disparue du catalogue : on retombe alors sur
  // Deepgram plutôt que de refuser un fichier à cause d'un réglage périmé.
  const chosen = advancedSettings.fileTranscriptionModelKey
    ? findModel(advancedSettings.fileTranscriptionModelKey)
    : undefined
  const useGoogle = chosen?.provider === 'google'
  const useOpenAI = chosen?.provider === 'openai'

  const deepgramApiKey = advancedSettings.deepgramApiKey?.trim()
  const googleApiKey = advancedSettings.googleApiKey?.trim()
  const openaiApiKey = advancedSettings.openaiApiKey?.trim()

  if (useGoogle && !googleApiKey) {
    return {
      ok: false,
      error: `${chosen?.label} needs a Google API key. Add one in Models.`,
    }
  }
  if (useOpenAI && !openaiApiKey) {
    return {
      ok: false,
      error: `${chosen?.label} needs an OpenAI API key. Add one in Models.`,
    }
  }
  if (!useGoogle && !useOpenAI && !deepgramApiKey) {
    return {
      ok: false,
      error:
        'Transcribing an imported file needs a Deepgram API key. Add one in Models.',
    }
  }

  try {
    const activeMode = await resolveActiveMode()
    const audio = fs.readFileSync(filePath)
    // Toujours diariser : c'est le seul moyen de SAVOIR combien de personnes
    // parlent. Le décider d'après un réglage de mode revenait à demander à
    // l'utilisateur une réponse qu'il n'a pas encore — il vient d'ouvrir le
    // fichier, pas de l'écouter.
    //
    // Le type MIME est annoncé dans les deux cas : annoncer audio/wav sur un
    // .m4a fait échouer le décodage côté Deepgram comme côté Google.
    const { text, segments } = useGoogle
      ? await googleTranscriptionService.transcribeAudio(audio, {
          apiKey: googleApiKey!,
          model: chosen!.slug,
          language: asrLanguageHint(activeMode.language),
          diarize: true,
          contentType: contentTypeFor(filePath),
          displayName: basename(filePath),
        })
      : useOpenAI
        ? await openaiTranscriptionService.transcribeAudio(audio, {
            apiKey: openaiApiKey!,
            model: chosen!.slug,
            language: asrLanguageHint(activeMode.language),
            diarize: true,
            contentType: contentTypeFor(filePath),
            fileName: basename(filePath),
          })
        : await deepgramTranscriptionService.transcribeAudio(audio, {
            apiKey: deepgramApiKey!,
            model: 'nova-3',
            language: asrLanguageHint(activeMode.language),
            diarize: true,
            contentType: contentTypeFor(filePath),
          })

    const speakerCount = new Set((segments ?? []).map(s => s.speaker)).size
    const isConversation = speakerCount >= 2
    const finalText =
      isConversation && segments?.length
        ? formatSpeakerTranscript(segments)
        : text

    // Le slug OpenAI est stocké nu : `EngineBadge` retrouve alors l'entrée
    // `provider: 'openai'` du catalogue (les slugs préfixés `openai/…`
    // désignent, eux, les mêmes modèles servis par OpenRouter).
    const engine = useGoogle
      ? `google/${chosen!.slug}`
      : useOpenAI
        ? chosen!.slug
        : 'deepgram/nova-3'

    const interactionId = await interactionManager.createRecoveredInteraction(
      finalText,
      16000,
      null,
      undefined,
      engine,
      {
        rawTranscript: text,
        // Aucun mode n'a traité ce fichier : lui en attribuer un ferait
        // remonter dans l'historique une ligne « dictée en mode X » qui n'a
        // jamais eu lieu.
        speakers: isConversation ? segments : undefined,
      },
    )

    // `createRecoveredInteraction` avale ses propres erreurs de base de
    // données et rend `undefined` plutôt que de lever (comportement
    // pré-existant, à ne pas changer ici) : un identifiant manquant EST
    // l'échec — sans quoi une écriture ratée après une transcription de
    // plusieurs minutes se rapporterait comme un succès, et rien
    // n'apparaîtrait dans l'historique.
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
      `[fileTranscription] Transcribed ${filePath} with ${engine} — ${
        isConversation ? `${speakerCount} speakers` : 'single speaker'
      }`,
    )
    return { ok: true, interactionId, speakerCount }
  } catch (error: any) {
    console.error('[fileTranscription] Failed:', error?.message || error)
    return { ok: false, error: error?.message || 'Transcription failed' }
  }
}
