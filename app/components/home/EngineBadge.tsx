import { findModelBySlug } from '@/lib/constants/modelCatalog'
import {
  MODEL_LAB_ICONS,
  PROVIDER_ICONS,
} from '@/app/components/icons/modelLabIcons'

const PROVIDER_LABELS: Record<string, string> = {
  groq: 'Groq',
  openrouter: 'OpenRouter',
}

/**
 * Which engine produced a transcript: the mark of the model's lab and of the
 * provider that served it, bare — no pill, no border.
 *
 * Two logos read faster than "Whisper · Groq" in a list scanned for its
 * content, and they stay honest as the catalogue grows: the text version had
 * three hard-coded labels and printed a raw slug for anything else. The full
 * names ride along in the tooltip.
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
  const ProviderIcon = PROVIDER_ICONS[model.pinnedProvider ?? model.provider]
  const providerLabel =
    PROVIDER_LABELS[model.pinnedProvider ?? model.provider] ?? model.provider

  return (
    <span
      className="inline-flex items-center gap-1.5"
      title={`${model.label} · ${providerLabel}`}
    >
      <span className="size-3.5 shrink-0 overflow-hidden rounded-[2px]">
        <LabIcon />
      </span>
      <span className="size-3.5 shrink-0 overflow-hidden rounded-[2px]">
        <ProviderIcon />
      </span>
    </span>
  )
}
