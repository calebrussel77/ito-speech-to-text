import type { ReactNode } from 'react'
import { findModelBySlug } from '@/lib/constants/modelCatalog'
import {
  MODEL_LAB_ICONS,
  PROVIDER_ICONS,
} from '@/app/components/icons/modelLabIcons'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/app/components/ui/tooltip'

const PROVIDER_LABELS: Record<string, string> = {
  groq: 'Groq',
  openrouter: 'OpenRouter',
  cerebras: 'Cerebras',
  google: 'Google',
  openai: 'OpenAI',
  deepgram: 'Deepgram',
}

function LogoWithTooltip({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger className="size-3.5 shrink-0 overflow-hidden rounded-[2px]">
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/**
 * Which engine produced a transcript: the mark of the model's lab and of the
 * provider that served it, bare — no pill, no border.
 *
 * Each logo carries its own tooltip rather than one for the pair, because they
 * answer different questions ("which model?" and "who ran it?") and a single
 * label would force the reader to work out which half applies to which mark.
 */
export default function EngineBadge({ engine }: { engine?: string | null }) {
  if (!engine) return null

  // Groq slugs are bare ("whisper-large-v3-turbo") and OpenRouter's are
  // namespaced ("openai/whisper-large-v3-turbo"), so the same model served by
  // both is never ambiguous here.
  const model = findModelBySlug('voice', engine)

  // A row from before this catalogue, or an engine since removed from it.
  if (!model) {
    return (
      <span className="text-[11px] leading-4 text-[var(--subtle-foreground)]">
        {engine}
      </span>
    )
  }

  const LabIcon = MODEL_LAB_ICONS[model.lab]
  const servedBy = model.pinnedProvider ?? model.provider
  const ProviderIcon = PROVIDER_ICONS[servedBy]

  return (
    <span className="inline-flex items-center gap-1.5">
      <LogoWithTooltip label={model.label}>
        <LabIcon />
      </LogoWithTooltip>
      <LogoWithTooltip label={PROVIDER_LABELS[servedBy] ?? servedBy}>
        <ProviderIcon />
      </LogoWithTooltip>
    </span>
  )
}
