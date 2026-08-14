import type { AdvancedSettings } from '../store'
import type { ContextData } from '../context/ContextGrabber'
import type { Mode } from '../sqlite/models'
import { DEFAULT_TEXT_KEY, resolveModel } from '../../constants/modelCatalog'
import { localTranscriptionService } from './LocalTranscriptionService'
import {
  openRouterChatService,
  type ChatMessage,
} from './OpenRouterChatService'
import { buildMessages } from '../modes/promptBuilder'

/**
 * Post-traite un transcript avec le modèle texte du mode.
 *
 * Toute erreur rend le transcript brut. Le post-traitement est une
 * amélioration, jamais une condition : perdre une dictée à cause d'un appel
 * LLM instable serait bien pire qu'insérer un texte plus rugueux.
 */
class TranscriptAdjuster {
  async adjust(
    transcript: string,
    mode: Mode,
    context: ContextData,
    advancedSettings: AdvancedSettings,
  ): Promise<string> {
    if (!transcript) return ''

    // Un mode sans réécriture veut le texte tel quel : pas d'aller-retour LLM.
    if (!mode.useLlm) return transcript.trim()

    const model = resolveModel(
      mode.textModelKey ?? advancedSettings?.textModelKey,
      DEFAULT_TEXT_KEY,
    )
    const messages: ChatMessage[] = await buildMessages(
      transcript,
      mode,
      context,
    )
    const temperature = advancedSettings?.llm?.llmTemperature ?? 0.1
    const maxTokens = transcript.length + 64 > 2048 ? 2048 : undefined

    try {
      const adjusted =
        model.provider === 'openrouter'
          ? await openRouterChatService.complete({
              apiKey: advancedSettings?.openRouterApiKey || '',
              model: model.slug,
              messages,
              temperature,
              maxTokens,
              pinnedProvider: model.pinnedProvider,
            })
          : await localTranscriptionService.complete({
              model: model.slug,
              messages,
              temperature,
              maxTokens,
            })

      return adjusted || transcript
    } catch (error: any) {
      console.error(
        `[TranscriptAdjuster] ${model.provider} adjustment failed (${model.slug}):`,
        error?.message || error,
      )
      return transcript
    }
  }
}

export const transcriptAdjuster = new TranscriptAdjuster()
