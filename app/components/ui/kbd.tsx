import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * Une touche de clavier.
 *
 * Le composant `kbd` de shadcn, aux tokens de l'app : `bg-muted` pointe déjà
 * sur `--surface-2`, donc la version d'origine tombe juste ici — seule la
 * graisse du chiffre est ajoutée (`tabular-nums`), parce qu'un raccourci se lit
 * en colonne dans la page Keyboard et que des chiffres de largeurs différentes
 * y font onduler la liste.
 *
 * Trois affichages de raccourci coexistaient avec chacun sa bordure, sa taille
 * et son fond : la liste des modes, la page Keyboard et la barre latérale.
 */
function Kbd({ className, ...props }: React.ComponentProps<'kbd'>) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        'pointer-events-none inline-flex h-4.5 w-fit min-w-4.5 items-center justify-center gap-1 rounded-[4px] border border-border bg-muted px-1 font-sans text-[10px] font-medium tabular-nums text-[var(--muted-foreground)] select-none',
        "[&_svg:not([class*='size-'])]:size-3",
        className,
      )}
      {...props}
    />
  )
}

/** Plusieurs touches d'un même accord, à écart constant. */
function KbdGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="kbd-group"
      className={cn('inline-flex items-center gap-1', className)}
      {...props}
    />
  )
}

export { Kbd, KbdGroup }
