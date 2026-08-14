import type { ComponentType } from 'react'

export interface PillTabItem<T extends string = string> {
  id: T
  label: string
  icon?: ComponentType<{ className?: string }>
}

/**
 * Sélecteur segmenté en pilule — le composant de tabs unique de l'app.
 * Conteneur arrondi complet à bordure fine, onglet actif en pilule pleine
 * avec bordure renforcée. Aucune couleur : l'état actif se lit au contraste
 * et à la bordure, comme le reste du système.
 */
export function PillTabs<T extends string>({
  items,
  value,
  onChange,
  className = '',
}: {
  items: PillTabItem<T>[]
  value: T
  onChange: (id: T) => void
  className?: string
}) {
  return (
    <div
      role="tablist"
      className={`inline-flex items-center gap-0.5 rounded-full border border-border bg-[var(--surface)] p-1 ${className}`}
    >
      {items.map(({ id, label, icon: Icon }) => {
        const isActive = id === value
        return (
          <button
            key={id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(id)}
            className={`flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs transition-colors duration-150 ${
              isActive
                ? 'border-[var(--border-strong)] bg-[var(--surface-3)] font-medium text-foreground'
                : 'border-transparent text-[var(--subtle-foreground)] hover:text-foreground'
            }`}
          >
            {Icon && <Icon className="h-[13px] w-[13px]" />}
            {label}
          </button>
        )
      })}
    </div>
  )
}
