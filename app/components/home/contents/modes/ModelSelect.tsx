import {
  VOICE_MODELS,
  TEXT_MODELS,
  type CatalogProvider,
} from '@/lib/constants/modelCatalog'
import { CONTROL_WIDTH } from '@/app/components/ui/settings'
import { cn } from '@/lib/utils'

const PROVIDER_LABEL: Record<CatalogProvider, string> = {
  groq: 'Groq',
  openrouter: 'OpenRouter',
}

/**
 * Un sélecteur de modèle, restreint aux modèles dont la clé fournisseur est
 * présente : proposer un modèle injoignable produit un échec au moment de la
 * dictée, c'est-à-dire au pire moment.
 */
export default function ModelSelect({
  kind,
  value,
  availableProviders,
  onChange,
}: {
  kind: 'voice' | 'text'
  value: string | null
  availableProviders: Set<string>
  onChange: (key: string | null) => void
}) {
  const catalog = kind === 'voice' ? VOICE_MODELS : TEXT_MODELS
  const models = catalog.filter(model => availableProviders.has(model.provider))

  // The stored value can name a model whose provider key was since removed
  // (e.g. an OpenRouter model on a Groq-only install). Filtering it out of
  // the option list would render "Default" — a lie, the pipeline still uses
  // the stored model — and the next change would write `null`, destroying
  // the choice. Keep it selectable, but say plainly that it can't run.
  const selected = value
    ? catalog.find(model => model.key === value)
    : undefined
  const selectedIsUnavailable = Boolean(
    selected && !availableProviders.has(selected.provider),
  )

  return (
    <select
      value={value ?? ''}
      onChange={event => onChange(event.target.value || null)}
      className={cn(
        'rounded-lg border border-border bg-transparent px-2 py-1 text-xs text-foreground',
        CONTROL_WIDTH,
      )}
    >
      <option value="">Default</option>
      {selectedIsUnavailable && selected && (
        <option value={selected.key}>
          {selected.label} (no {PROVIDER_LABEL[selected.provider]} key)
        </option>
      )}
      {models.map(model => (
        <option key={model.key} value={model.key}>
          {model.label}
        </option>
      ))}
    </select>
  )
}
