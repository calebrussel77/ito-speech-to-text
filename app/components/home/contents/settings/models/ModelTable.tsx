import { Check } from '@mynaui/icons-react'
import type { CatalogModel } from '@/lib/constants/modelCatalog'
import { MODEL_LAB_ICONS } from '@/app/components/icons/modelLabIcons'
import { cn } from '@/lib/utils'

/**
 * One assignable role. The voice table gets two of these when the
 * long-dictation engine is on ("Short" and "Long"), one otherwise; the text
 * table always gets one.
 */
export type ModelSlot = {
  id: string
  /** Column header. Omitted when there is only one slot. */
  label?: string
  selectedKey: string
  onSelect: (key: string) => void
  /** Only models satisfying this can be assigned to the slot. */
  accepts: (model: CatalogModel) => boolean
}

type ModelTableProps = {
  title: string
  description?: string
  models: CatalogModel[]
  slots: ModelSlot[]
  /** Providers whose API key is configured. Others render disabled. */
  availableProviders: Set<string>
  onRequestKey: (provider: string) => void
}

/**
 * Five-step gauge. Empty steps are drawn rather than omitted so that "we did
 * not measure this" reads differently from "this is slow" — most OpenRouter
 * models have no published throughput, and inventing bars for them would turn
 * a blank into a verdict.
 */
function Gauge({ value }: { value?: number }) {
  if (value === undefined) {
    return <span className="text-[var(--subtle-foreground)]">—</span>
  }
  return (
    <span className="flex items-center gap-[3px]" aria-label={`${value} of 5`}>
      {[1, 2, 3, 4, 5].map(step => (
        <span
          key={step}
          className={cn(
            'h-[3px] w-2 rounded-full',
            step <= value ? 'bg-foreground/70' : 'bg-foreground/15',
          )}
        />
      ))}
    </span>
  )
}

function SlotButton({
  active,
  disabled,
  label,
  onClick,
}: {
  active: boolean
  disabled: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors duration-150',
        active
          ? 'border-foreground bg-foreground text-[var(--background)]'
          : 'border-border-strong text-transparent hover:border-foreground/60',
        disabled && 'cursor-not-allowed opacity-30 hover:border-border-strong',
      )}
    >
      <Check className="size-2.5" strokeWidth={3} />
    </button>
  )
}

export default function ModelTable({
  title,
  description,
  models,
  slots,
  availableProviders,
  onRequestKey,
}: ModelTableProps) {
  const showSlotLabels = slots.length > 1
  // Providers that gate at least one row and have no key yet — one action link
  // per provider at the end of the table, since a disabled row cannot be
  // clicked and would otherwise be a dead end.
  const missingProviders = [
    ...new Set(
      models
        .filter(model => !availableProviders.has(model.provider))
        .map(model => model.provider),
    ),
  ]

  return (
    <section className="mb-6 last:mb-0">
      <header className="mb-1.5">
        <h2 className="font-heading text-xs font-semibold tracking-tight text-foreground">
          {title}
        </h2>
        {description && (
          <p className="mt-0.5 text-[11px] leading-snug text-[var(--subtle-foreground)]">
            {description}
          </p>
        )}
      </header>

      <div className="surface-1 overflow-hidden rounded-xl">
        <div className="flex items-center gap-3 border-b border-border/70 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-[var(--subtle-foreground)]">
          <span className="min-w-0 flex-1">Model</span>
          <span className="w-[100px] shrink-0 text-right">Price</span>
          <span className="w-[62px] shrink-0 text-right">Speed</span>
          <span
            className="flex shrink-0 gap-2"
            style={{ width: slots.length * 40 }}
          >
            {slots.map(slot => (
              <span key={slot.id} className="w-8 text-center">
                {showSlotLabels ? slot.label : ''}
              </span>
            ))}
          </span>
        </div>

        <div className="divide-y divide-border/50">
          {models.map(model => {
            const LabIcon = MODEL_LAB_ICONS[model.lab]
            const unavailable = !availableProviders.has(model.provider)

            return (
              <div
                key={model.key}
                className={cn(
                  'flex items-center gap-3 px-3 py-2',
                  unavailable && 'opacity-40',
                )}
              >
                <span className="flex min-w-0 flex-1 items-center gap-2.5">
                  <span className="size-4 shrink-0 overflow-hidden rounded-[3px]">
                    <LabIcon />
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-xs text-foreground">
                        {model.label}
                      </span>
                      {model.pinnedProvider && (
                        <span className="shrink-0 rounded-full border border-border-strong px-1.5 py-px text-[9px] uppercase tracking-wide text-[var(--muted-foreground)]">
                          {model.pinnedProvider}
                        </span>
                      )}
                      {model.proven && (
                        <span className="shrink-0 rounded-full border border-border-strong px-1.5 py-px text-[9px] uppercase tracking-wide text-[var(--muted-foreground)]">
                          Tested
                        </span>
                      )}
                    </span>
                    {(model.note || unavailable) && (
                      <span className="block truncate text-[10px] leading-snug text-[var(--subtle-foreground)]">
                        {unavailable
                          ? `${model.provider === 'groq' ? 'Groq' : 'OpenRouter'} key required`
                          : model.note}
                      </span>
                    )}
                  </span>
                </span>

                <span className="w-[100px] shrink-0 text-right text-[10px] tabular-nums text-[var(--muted-foreground)]">
                  {model.price ?? '—'}
                </span>
                <span className="flex w-[62px] shrink-0 justify-end text-[10px]">
                  <Gauge value={model.speed} />
                </span>

                <span
                  className="flex shrink-0 gap-2"
                  style={{ width: slots.length * 40 }}
                >
                  {slots.map(slot => {
                    const accepted = slot.accepts(model)
                    return (
                      <span key={slot.id} className="flex w-8 justify-center">
                        {accepted ? (
                          <SlotButton
                            active={slot.selectedKey === model.key}
                            disabled={unavailable}
                            label={`${slot.label || 'Use'} — ${model.label}`}
                            onClick={() => slot.onSelect(model.key)}
                          />
                        ) : null}
                      </span>
                    )
                  })}
                </span>
              </div>
            )
          })}
        </div>

        {missingProviders.length > 0 && (
          <div className="flex flex-wrap gap-3 border-t border-border/70 px-3 py-2">
            {missingProviders.map(provider => (
              <button
                key={provider}
                type="button"
                onClick={() => onRequestKey(provider)}
                className="text-[11px] text-[var(--muted-foreground)] underline-offset-2 transition-colors hover:text-foreground hover:underline"
              >
                Add a {provider === 'groq' ? 'Groq' : 'OpenRouter'} key →
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
