import {
  VOICE_MODELS,
  TEXT_MODELS,
  PROVIDER_LABELS,
} from '@/lib/constants/modelCatalog'
import { Fragment } from 'react'
import { MODEL_LAB_ICONS } from '@/app/components/icons/modelLabIcons'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/app/components/ui/select'
import { CONTROL_WIDTH } from '@/app/components/ui/settings'
import { cn } from '@/lib/utils'

/**
 * « Aucun modèle choisi » se stocke `null`, mais Radix réserve la chaîne vide
 * pour « rien de sélectionné » et refuse de l'accepter comme valeur d'option.
 * D'où ce jeton, qui ne vit qu'entre le sélecteur et son `onChange`.
 */
const DEFAULT_VALUE = '__default__'

/** Le logo du laboratoire, à la taille et au cadrage du tableau des modèles. */
function LabLogo({ lab }: { lab: keyof typeof MODEL_LAB_ICONS }) {
  const Icon = MODEL_LAB_ICONS[lab]
  return (
    <span className="size-3.5 shrink-0 overflow-hidden rounded-[3px]">
      <Icon />
    </span>
  )
}

/**
 * Un sélecteur de modèle. Tout le catalogue est visible, mais seuls les
 * modèles dont la clé fournisseur est présente se sélectionnent : proposer un
 * modèle injoignable produirait un échec au moment de la dictée, c'est-à-dire
 * au pire moment — le griser dit à la place où va la clé qui manque.
 */
export default function ModelSelect({
  kind,
  value,
  availableProviders,
  keys,
  disabled,
  disabledReason,
  onChange,
}: {
  kind: 'voice' | 'text'
  value: string | null
  availableProviders: Set<string>
  /**
   * Restreint la liste à ces clés du catalogue. Sert au réglage « fichier
   * importé », que seuls certains modèles savent traiter. Sans elle, les
   * modèles `fileOnly` sont exclus : ils ne peuvent pas transcrire une dictée
   * en direct, et les proposer comme modèle vocal d'un mode ne produirait
   * qu'un échec au moment de parler.
   */
  keys?: readonly string[]
  /** Grise le sélecteur sans le retirer : un contrôle absent ne s'explique pas. */
  disabled?: boolean
  /** Pourquoi il est grisé. Affiché sous le sélecteur. */
  disabledReason?: string
  onChange: (key: string | null) => void
}) {
  const catalog = (kind === 'voice' ? VOICE_MODELS : TEXT_MODELS).filter(
    model => (keys ? keys.includes(model.key) : !model.fileOnly),
  )

  // Le stocké peut nommer un modèle dont la clé fournisseur a disparu depuis
  // (un modèle OpenRouter sur une installation Groq seule). Le sortir de la
  // liste afficherait « Default » — un mensonge, le pipeline utilise toujours
  // le modèle stocké — et le changement suivant écrirait `null`, détruisant le
  // choix. Il reste donc listé (grisé), et la note dit qu'il ne peut pas
  // tourner.
  const selected = value
    ? catalog.find(model => model.key === value)
    : undefined
  const selectedIsUnavailable = Boolean(
    selected && !availableProviders.has(selected.provider),
  )

  // Dans l'ordre du catalogue, pas alphabétique : le catalogue est trié par
  // pertinence, et regrouper ne doit pas réordonner ce qui est proposé en
  // premier. TOUT le catalogue s'affiche, clé présente ou non — un groupe
  // absent se lit comme « ce modèle n'existe pas », pas comme « il manque une
  // clé ». Sans clé, le groupe est étiqueté et ses modèles sont grisés, comme
  // les lignes des tableaux plus bas.
  const byProvider = [
    ...new Map(
      catalog.map(model => [
        model.provider,
        catalog.filter(other => other.provider === model.provider),
      ]),
    ).entries(),
  ]

  const anyAvailable = catalog.some(model =>
    availableProviders.has(model.provider),
  )

  // Sans aucune clé, tout est grisé — un sélecteur qui n'a rien à sélectionner
  // se lit comme « on ne peut pas changer de modèle » plutôt que comme « il
  // manque une clé ». Le dire ici évite d'aller chercher pourquoi ailleurs.
  const note = disabled
    ? disabledReason
    : !anyAvailable
      ? 'No provider key yet — add one in Models → Providers to pick a model.'
      : selectedIsUnavailable && selected
        ? `${selected.label} can't run without a ${PROVIDER_LABELS[selected.provider]} key — add one in Models → Providers.`
        : null

  return (
    <>
      <Select
        // `|| `, pas `?? ` : le réglage « modèle par défaut des nouveaux
        // modes » stocke la chaîne vide plutôt que `null`, et Radix la traite
        // comme « rien de sélectionné » — le déclencheur restait vide.
        value={value || DEFAULT_VALUE}
        disabled={disabled}
        onValueChange={next => onChange(next === DEFAULT_VALUE ? null : next)}
      >
        <SelectTrigger className={CONTROL_WIDTH}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={DEFAULT_VALUE}>Default</SelectItem>
          {/* Groupé par fournisseur : le logo d'un modèle dit quel laboratoire
              l'a produit, jamais qui le sert — et c'est le fournisseur qu'on
              paie, dont on colle la clé, et qui décide de la latence.
              Séparateur + libellé seul : un logo en tête de groupe donnait à
              l'en-tête la même silhouette qu'une option, et la liste devenait
              illisible. Rien ne se sélectionne sur cette ligne, elle ne doit
              donc rien porter qui ressemble à un choix. */}
          {byProvider.map(([provider, providerModels]) => {
            const providerAvailable = availableProviders.has(provider)
            return (
              <Fragment key={provider}>
                <SelectSeparator />
                <SelectGroup>
                  <SelectLabel>
                    {PROVIDER_LABELS[provider]}
                    {!providerAvailable && ' — no key yet'}
                  </SelectLabel>
                  {providerModels.map(model => (
                    <SelectItem
                      key={model.key}
                      value={model.key}
                      disabled={!providerAvailable}
                    >
                      <LabLogo lab={model.lab} />
                      {model.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </Fragment>
            )
          })}
        </SelectContent>
      </Select>
      {note && (
        <span
          className={cn(
            'text-right text-[10px] leading-snug text-[var(--subtle-foreground)]',
            CONTROL_WIDTH,
          )}
        >
          {note}
        </span>
      )}
    </>
  )
}
