import fs from 'fs'
import { deepgramTranscriptionService } from './DeepgramTranscriptionService'
import { transcriptAdjuster } from './TranscriptAdjuster'
import { interactionManager } from '../interactions/InteractionManager'
import { resolveMode } from '../modes/activeMode'
import { getAdvancedSettings } from '../store'
import { asrLanguageHint } from '../../constants/modeLanguages'
import {
  resolveModel,
  DEFAULT_SHORT_VOICE_KEY,
} from '../../constants/modelCatalog'
import {
  chooseTranscriptionPath,
  FILE_PATH_THRESHOLD_MS,
} from './transcriptionRouter'

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
 * Le choix du transport passe par `chooseTranscriptionPath`, la même
 * décision que pour une dictée en direct, plutôt que de la redécider ici. La
 * durée réelle d'un conteneur compressé n'est pas connue sans le décoder, et
 * les chemins courts (Groq/OpenRouter) n'ont de toute façon pas de sens pour
 * un fichier qui n'a pas été enregistré par Ito : pas de WAV, pas de filet de
 * récupération. On force donc les paramètres du routeur pour qu'il ne rende
 * que deux issues possibles — Deepgram, ou l'erreur qui demande une clé.
 */
export async function transcribeExistingFile(
  filePath: string,
  modeId?: string,
): Promise<{ ok: boolean; interactionId?: string; error?: string }> {
  if (!fs.existsSync(filePath)) {
    return { ok: false, error: 'File not found' }
  }

  const advancedSettings = getAdvancedSettings()
  const mode = await resolveMode(modeId)
  const voiceModel = resolveModel(
    mode.voiceModelKey ?? undefined,
    DEFAULT_SHORT_VOICE_KEY,
  )

  const decision = chooseTranscriptionPath({
    voiceModelProvider:
      voiceModel.provider === 'openrouter' ? 'openrouter' : 'groq',
    // Un fichier importé est toujours traité comme long : on ne connaît pas
    // sa durée réelle sans le décoder.
    durationMs: FILE_PATH_THRESHOLD_MS,
    // … et les plafonds WAV du chemin court ne veulent rien dire pour un
    // conteneur arbitraire : les exclure garantit que le routeur ne tente
    // jamais un repli Groq/OpenRouter qu'on n'implémente pas ici.
    wavBytes: Number.POSITIVE_INFINITY,
    identifySpeakers: mode.identifySpeakers,
    hasOpenRouterKey: !!advancedSettings.openRouterApiKey?.trim(),
    hasDeepgramKey: !!advancedSettings.deepgramApiKey?.trim(),
  })

  if (decision.path === null) {
    return { ok: false, error: decision.reason }
  }
  if (decision.path !== 'deepgram') {
    // Ne devrait jamais arriver : les paramètres forcés ci-dessus excluent
    // groq/openrouter. Filet de sécurité si le routeur change un jour.
    return {
      ok: false,
      error: 'Transcribing a file needs a Deepgram API key. Add one in Models.',
    }
  }

  const apiKey = advancedSettings.deepgramApiKey!.trim()

  try {
    const audio = fs.readFileSync(filePath)
    const { text, segments } =
      await deepgramTranscriptionService.transcribeAudio(audio, {
        apiKey,
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

    console.log(
      `[fileTranscription] Transcribed ${filePath} in mode "${mode.name}"`,
    )
    return { ok: true, interactionId }
  } catch (error: any) {
    console.error('[fileTranscription] Failed:', error?.message || error)
    return { ok: false, error: error?.message || 'Transcription failed' }
  }
}
