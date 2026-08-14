import type { ReactNode } from 'react'

/**
 * Primitives des écrans de réglages.
 *
 * Les cinq onglets recopiaient chacun leur propre `flex items-center
 * justify-between` avec des tailles et des espacements légèrement différents —
 * d'où cinq pages qui ne se ressemblaient pas. Tout passe désormais par
 * `SettingsRow`, seul endroit où se décident la typo, l'alignement et la
 * largeur de la colonne de contrôles.
 */

/** Largeur canonique de la colonne de contrôles (selects, boutons, champs). */
export const CONTROL_WIDTH = 'w-[168px]'

export function SettingsGroup({
  title,
  description,
  children,
}: {
  title?: string
  description?: string
  children: ReactNode
}) {
  return (
    <section className="mb-6 last:mb-0">
      {title && (
        <header className="mb-1">
          <h2 className="font-heading text-xs font-semibold tracking-tight text-foreground">
            {title}
          </h2>
          {description && (
            <p className="mt-0.5 text-[11px] leading-snug text-[var(--subtle-foreground)]">
              {description}
            </p>
          )}
        </header>
      )}
      {/* Les séparateurs remplacent les grands espacements verticaux : ils
          structurent la liste sans coûter de hauteur, ce qui compte dans une
          fenêtre de 620px. */}
      <div className="divide-y divide-border/70">{children}</div>
    </section>
  )
}

export function SettingsRow({
  title,
  description,
  children,
  align = 'center',
}: {
  title: string
  description?: ReactNode
  /** Le contrôle, aligné à droite. */
  children?: ReactNode
  /** `start` quand le contrôle fait plus d'une ligne (groupe de boutons…). */
  align?: 'center' | 'start'
}) {
  return (
    <div
      className={`flex gap-5 py-2.5 ${
        align === 'center' ? 'items-center' : 'items-start'
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-foreground">{title}</div>
        {description && (
          <div className="mt-0.5 text-[11px] leading-snug text-[var(--subtle-foreground)]">
            {description}
          </div>
        )}
      </div>
      {children && (
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {children}
        </div>
      )}
    </div>
  )
}

/** Bloc encadré, pour les réglages qui portent leur propre formulaire. */
export function SettingsCard({
  title,
  description,
  action,
  children,
}: {
  title: string
  description?: string
  /** Lien ou bouton secondaire, en haut à droite. */
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="surface-1 mb-3 rounded-xl p-3.5 last:mb-0">
      <div className="mb-2.5 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="font-heading text-xs font-semibold tracking-tight text-foreground">
            {title}
          </h3>
          {description && (
            <p className="mt-0.5 text-[11px] leading-snug text-[var(--subtle-foreground)]">
              {description}
            </p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </div>
  )
}

/** Message d'état sous un contrôle (succès, erreur, information). */
export function SettingsNote({
  tone = 'muted',
  children,
}: {
  tone?: 'muted' | 'error'
  children: ReactNode
}) {
  return (
    <p
      className={`text-[11px] leading-snug ${
        tone === 'error'
          ? 'text-destructive'
          : 'text-[var(--subtle-foreground)]'
      }`}
    >
      {children}
    </p>
  )
}
