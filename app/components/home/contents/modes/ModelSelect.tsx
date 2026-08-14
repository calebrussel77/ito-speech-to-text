import { VOICE_MODELS, TEXT_MODELS } from '@/lib/constants/modelCatalog'
import { CONTROL_WIDTH } from '@/app/components/ui/settings'
import { cn } from '@/lib/utils'

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
  const models = (kind === 'voice' ? VOICE_MODELS : TEXT_MODELS).filter(model =>
    availableProviders.has(model.provider),
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
      {models.map(model => (
        <option key={model.key} value={model.key}>
          {model.label}
        </option>
      ))}
    </select>
  )
}
