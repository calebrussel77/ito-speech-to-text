import { modeIcon } from '@/app/components/modeIcons'
import { Kbd } from '@/app/components/ui/kbd'
import { usePlatform } from '@/app/hooks/usePlatform'
import { formatChord, formatChordDetailed } from '@/app/utils/keyboard'
import type { KeyName } from '@/lib/types/keyboard'
import { cn } from '@/lib/utils'
import { findPreset } from '@/lib/constants/modePresets'
import type { ModeDto } from '@/app/index'

/**
 * Une ligne de la liste des modes.
 *
 * La pastille du mode est le seul aplat de couleur autorisé par la charte, et
 * seulement à 6 px — d'où `size-1.5` et jamais de fond teinté. Elle ne porte
 * plus le vert « actif » mais la **teinte propre du mode** : c'est le même
 * point, à la même couleur, que celui que la pill affiche pendant la dictée.
 * L'activation, elle, se lit au remplissage — pleine pour le mode actif, en
 * simple anneau pour les autres.
 */
export default function ModeRow({
  mode,
  color,
  isActive,
  shortcut,
  onOpen,
  onActivate,
}: {
  mode: ModeDto
  /** Teinte du mode, cf. lib/constants/modeColors.ts. */
  color: string
  isActive: boolean
  /** Touches du raccourci dédié, ou null si le mode n'en a pas. */
  shortcut: KeyName[] | null
  onOpen: () => void
  onActivate: () => void
}) {
  const platform = usePlatform()
  const Icon = modeIcon(mode.icon)
  // `mode.preset` is a raw key like 'voice-to-text' — show the human label
  // from the preset catalogue instead, falling back to the raw value for a
  // custom preset that has none.
  const presetLabel = findPreset(mode.preset)?.label ?? mode.preset
  // The list is where the user picks the active mode, and picking wrong
  // means an unrepeatable meeting recorded from the wrong source — so a mode
  // that grabs the call must say so here, not only in the editor. Distinct
  // wording for 'system' vs 'both': the latter still has the microphone in
  // the mix, the former doesn't.
  const audioSourceLabel =
    mode.audioSource === 'both'
      ? 'mic + system audio'
      : mode.audioSource === 'system'
        ? 'system audio'
        : null

  return (
    <div
      className={cn(
        'group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors duration-150',
        'hover:bg-secondary/40',
      )}
    >
      {/* La cible fait 16 px pour la souris alors que la pastille en fait 6 :
          c'est le seul geste de la ligne qui ne mène nulle part, il ne peut pas
          demander de la précision. Le halo au survol dit qu'elle est cliquable
          — sans lui, rien ne l'annonçait. */}
      <button
        type="button"
        onClick={onActivate}
        title={isActive ? 'Active mode' : 'Make this the active mode'}
        className={cn(
          'flex size-4 shrink-0 items-center justify-center rounded-full transition-colors duration-150',
          !isActive && 'hover:bg-[var(--surface-3)]',
        )}
      >
        {isActive ? (
          <span
            className="size-1.5 rounded-full"
            style={{
              backgroundColor: color,
              boxShadow: `0 0 0 3px ${color}26`,
            }}
          />
        ) : (
          <span
            className="size-1.5 rounded-full border"
            style={{ borderColor: `${color}99` }}
          />
        )}
      </button>

      <Icon className="size-4 shrink-0 text-[var(--muted-foreground)]" />

      <button
        type="button"
        onClick={onOpen}
        className="min-w-0 flex-1 text-left"
      >
        <span className="flex items-center gap-1.5">
          <span className="truncate text-xs font-medium text-foreground">
            {mode.name}
          </span>
          {/* Écrit, pas seulement dessiné : la différence entre une pastille
              pleine et un anneau de 6 px ne se voit pas d'un coup d'œil, et
              c'est pourtant le réglage que la ligne porte. */}
          {isActive && (
            <span className="shrink-0 rounded border border-border px-1.5 py-px text-[9px] uppercase tracking-wide text-[var(--muted-foreground)]">
              Active
            </span>
          )}
        </span>
        <span className="block truncate text-[11px] leading-snug text-[var(--subtle-foreground)]">
          {mode.useLlm ? presetLabel : 'Raw transcript'}
          {audioSourceLabel && ` · ${audioSourceLabel}`}
        </span>
      </button>

      {shortcut && (
        <Kbd
          className="shrink-0"
          title={formatChordDetailed(shortcut, platform)}
        >
          {formatChord(shortcut, platform)}
        </Kbd>
      )}
    </div>
  )
}
