import fs from 'fs'
import { deepgramTranscriptionService } from './DeepgramTranscriptionService'
import { transcriptAdjuster } from './TranscriptAdjuster'
import { interactionManager } from '../interactions/InteractionManager'
import { resolveMode, resolveActiveMode } from '../modes/activeMode'
import { getAdvancedSettings } from '../store'
import { asrLanguageHint } from '../../constants/modeLanguages'

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
 * Traite un enregistrement fait ailleurs (Teams, OBS, un dictaphone) avec un
 * mode existant.
 *
 * C'est le filet du mode Meeting : la première réunion qu'on veut résumer est
 * toujours celle qu'on a oublié de lancer dans Ito. Le fichier n'est jamais
 * touché — on le lit, on l'envoie tel quel à Deepgram avec le bon type MIME,
 * et on ne le déplace ni ne le supprime.
 *
 * Un fichier importé n'a pas été enregistré par Ito : pas de WAV, pas de
 * filet de récupération, donc pas de sens à emprunter les chemins courts
 * (Groq/OpenRouter) qu'utilise `chooseTranscriptionPath` pour une dictée en
 * direct. On l'exigeait déjà en pratique en forçant ses paramètres pour
 * qu'il ne rende que "Deepgram" ou un refus — mais ce refus recyclait le
 * message du routeur ("trop long"), qui mentait pour un mémo de dix
 * secondes : le vrai motif n'a jamais été la durée, faute de la connaître
 * sans décoder le fichier. On l'exprime donc directement ici : ce chemin
 * exige toujours une clé Deepgram, un point c'est tout.
 */
export async function transcribeExistingFile(
  filePath: string,
  modeId?: string,
): Promise<{ ok: boolean; interactionId?: string; error?: string }> {
  if (!fs.existsSync(filePath)) {
    return { ok: false, error: 'File not found' }
  }

  const advancedSettings = getAdvancedSettings()
  // Sans modeId explicite — le seul appelant aujourd'hui, le bouton "Transcribe
  // a file" — c'est le mode actif qui doit transcrire, pas le premier de la
  // liste : resolveMode(undefined) replie sur l'ordre de tri (ModesTable.findAll),
  // pas sur ce que l'utilisateur a choisi comme actif.
  const mode = modeId ? await resolveMode(modeId) : await resolveActiveMode()

  const deepgramApiKey = advancedSettings.deepgramApiKey?.trim()
  if (!deepgramApiKey) {
    return {
      ok: false,
      error:
        'Transcribing an imported file needs a Deepgram API key. Add one in Models.',
    }
  }

  try {
    const audio = fs.readFileSync(filePath)
    const { text, segments } =
      await deepgramTranscriptionService.transcribeAudio(audio, {
        apiKey: deepgramApiKey,
        model: 'nova-3',
        language: asrLanguageHint(mode.language),
        diarize: mode.identifySpeakers,
        // Deepgram accepte les conteneurs courants, mais il faut le lui dire :
        // annoncer audio/wav sur un .m4a ferait échouer le décodage.
        contentType: contentTypeFor(filePath),
      })

    const finalText = mode.useLlm
      ? await transcriptAdjuster.adjust(
          text,
          mode,
          {
            vocabularyWords: [],
            dictionaryEntries: [],
            windowTitle: '',
            appName: '',
            contextText: '',
            clipboardText: '',
            advancedSettings,
          },
          advancedSettings,
        )
      : text

    const interactionId = await interactionManager.createRecoveredInteraction(
      finalText,
      16000,
      null,
      undefined,
      'deepgram/nova-3',
      {
        rawTranscript: text,
        modeId: mode.id,
        modeName: mode.name,
        speakers: segments,
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
      `[fileTranscription] Transcribed ${filePath} in mode "${mode.name}"`,
    )
    return { ok: true, interactionId }
  } catch (error: any) {
    console.error('[fileTranscription] Failed:', error?.message || error)
    return { ok: false, error: error?.message || 'Transcription failed' }
  }
}
