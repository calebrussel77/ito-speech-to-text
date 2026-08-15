import type React from 'react'
import type { ModelLab } from '@/lib/constants/modelCatalog'
import CerebrasIcon from './CerebrasIcon'
import ChatGPTIcon from './ChatGPTIcon'
import ClaudeIcon from './ClaudeIcon'
import DeepgramIcon from './DeepgramIcon'
import GeminiIcon from './GeminiIcon'
import GoogleIcon from './GoogleIcon'
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

// Google's mark ships with fixed pixel dimensions; the other logos fill their
// container, so stretch it to match.
const GoogleProviderIcon = ({ className }: LogoProps) => (
  <GoogleIcon className={className ?? 'h-full w-full'} />
)

export const PROVIDER_ICONS: Record<
  'groq' | 'openrouter' | 'cerebras' | 'deepgram' | 'google' | 'openai',
  React.ComponentType<LogoProps>
> = {
  groq: GroqIcon,
  openrouter: OpenRouterIcon,
  cerebras: CerebrasIcon,
  deepgram: DeepgramIcon,
  google: GoogleProviderIcon,
  openai: ChatGPTIcon,
}
