import { modeIcon } from './modeIcons'
import { cn } from '@/lib/utils'
import type { ModeDto } from '@/app/index'

/**
 * Une ligne de la liste des modes.
 *
 * La pastille verte du mode actif est le seul aplat de couleur autorisé par la
 * charte, et seulement à 6 px — d'où `size-1.5` et jamais de fond teinté.
 */
export default function ModeRow({
  mode,
  isActive,
  shortcut,
  onOpen,
  onActivate,
}: {
  mode: ModeDto
  isActive: boolean
  /** Combinaison affichable, ou null si le mode n'a pas de raccourci dédié. */
  shortcut: string | null
  onOpen: () => void
  onActivate: () => void
}) {
  const Icon = modeIcon(mode.icon)

  return (
    <div
      className={cn(
        'group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors duration-150',
        'hover:bg-secondary/40',
      )}
    >
      <button
        type="button"
        onClick={onActivate}
        title={isActive ? 'Active mode' : 'Make this the active mode'}
        className="flex size-4 shrink-0 items-center justify-center"
      >
        {isActive ? (
          <span className="size-1.5 rounded-full bg-[var(--positive)]" />
        ) : (
          <span className="size-1.5 rounded-full border border-border-strong" />
        )}
      </button>

      <Icon className="size-4 shrink-0 text-[var(--subtle-foreground)]" />

      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <span className="block truncate text-xs font-medium text-foreground">
          {mode.name}
        </span>
        <span className="block truncate text-[11px] leading-snug text-[var(--subtle-foreground)]">
          {mode.useLlm ? mode.preset : 'Raw transcript'}
          {mode.audioSource !== 'microphone' && ' · system audio'}
        </span>
      </button>

      {shortcut && (
        <span className="shrink-0 rounded border border-border px-1.5 py-px text-[10px] tabular-nums text-[var(--subtle-foreground)]">
          {shortcut}
        </span>
      )}
    </div>
  )
}
