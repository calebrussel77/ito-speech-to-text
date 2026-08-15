import type React from 'react'
import type { ModelLab } from '@/lib/constants/modelCatalog'
import CerebrasIcon from './CerebrasIcon'
import ChatGPTIcon from './ChatGPTIcon'
import ClaudeIcon from './ClaudeIcon'
import DeepgramIcon from './DeepgramIcon'
import GeminiIcon from './GeminiIcon'
import GroqIcon from './GroqIcon'
import MistralIcon from './MistralIcon'
import OpenRouterIcon from './OpenRouterIcon'
import QwenIcon from './QwenIcon'
import ZaiIcon from './ZaiIcon'

type LogoProps = { className?: string }

// Anthropic, OpenAI and Qwen already shipped as app icons; the rest come from
// theSVG. OpenRouter, OpenAI, Qwen and Z.ai have no colour mark — their brands
// are monochrome, so they inherit the surrounding text colour.
export const MODEL_LAB_ICONS: Record<
  ModelLab,
  React.ComponentType<LogoProps>
> = {
  anthropic: ClaudeIcon,
  cerebras: CerebrasIcon,
  deepgram: DeepgramIcon,
  google: GeminiIcon,
  groq: GroqIcon,
  mistral: MistralIcon,
  openai: ChatGPTIcon,
  qwen: QwenIcon,
  zai: ZaiIcon,
}

export const PROVIDER_ICONS: Record<
  'groq' | 'openrouter' | 'cerebras' | 'deepgram',
  React.ComponentType<LogoProps>
> = {
  groq: GroqIcon,
  openrouter: OpenRouterIcon,
  cerebras: CerebrasIcon,
  deepgram: DeepgramIcon,
}
