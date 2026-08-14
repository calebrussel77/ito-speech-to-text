import { ItoMode } from '@/app/generated/ito_pb'
import type { AdvancedSettings } from '../store'
import type { ContextData } from '../context/ContextGrabber'
import { DEFAULT_TEXT_KEY, resolveModel } from '../../constants/modelCatalog'
import { localTranscriptionService } from './LocalTranscriptionService'
import {
  openRouterChatService,
  type ChatMessage,
} from './OpenRouterChatService'

const DEFAULT_EDITING_PROMPT =
  'Polish the transcript for clarity and grammar without changing intent.'

const MODE_PROMPTS: Record<number, string> = {
  [ItoMode.EDIT]:
    "You are in EDIT mode. Use the provided context (window title, app name, and selected text) to adjust the transcript. Keep the user's intent and be concise.",
  [ItoMode.TRANSCRIBE]:
    'You are in TRANSCRIBE mode. Lightly clean the transcript for casing and spacing while preserving words.',
}

function buildMessages(
  transcript: string,
  mode: ItoMode,
  context: ContextData,
  advancedSettings: AdvancedSettings,
): ChatMessage[] {
  const editingPrompt =
    advancedSettings?.llm?.editingPrompt || DEFAULT_EDITING_PROMPT
  const modePrompt = MODE_PROMPTS[mode] ?? MODE_PROMPTS[ItoMode.TRANSCRIBE]

  const contextSummary = [
    context.windowTitle && `Window: ${context.windowTitle}`,
    context.appName && `App: ${context.appName}`,
    context.contextText && `Selected: ${context.contextText}`,
  ]
    .filter(Boolean)
    .join(' | ')

  return [
    { role: 'system', content: `${modePrompt}\n${editingPrompt}` },
    {
      role: 'user',
      content: `Transcript:\n${transcript}\n\nContext:\n${contextSummary || 'None'}`,
    },
  ]
}

/**
 * Post-processes a transcript with the chosen text model.
 *
 * The catalogue decides where the call goes: Groq directly, or OpenRouter —
 * optionally pinned to a specific upstream. Until this existed the LLM
 * provider setting was decorative, because every call went to Groq whatever
 * the user had selected.
 *
 * Any failure returns the raw transcript. Post-processing is an improvement,
 * never a precondition: losing a dictation to a flaky LLM call would be a far
 * worse outcome than inserting slightly rougher text.
 */
class TranscriptAdjuster {
  async adjust(
    transcript: string,
    mode: ItoMode,
    context: ContextData,
    advancedSettings: AdvancedSettings,
  ): Promise<string> {
    if (!transcript) return ''

    // TRANSCRIBE mode wants raw output; only EDIT mode earns an LLM round trip.
    if (mode === ItoMode.TRANSCRIBE) {
      return transcript.trim()
    }

    const model = resolveModel(advancedSettings?.textModelKey, DEFAULT_TEXT_KEY)
    const messages = buildMessages(transcript, mode, context, advancedSettings)
    const temperature = advancedSettings?.llm?.llmTemperature ?? 0.1
    // Editing rewrites a transcript, it does not expand on it; the cap stops a
    // model that starts rambling from burning tokens and latency.
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
