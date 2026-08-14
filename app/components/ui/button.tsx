import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

/**
 * Boutons en pilule, comme les tabs (`pill-tabs.tsx`) et la référence de
 * design. Les ombres portées sont retirées : sur un fond near-black elles ne
 * se voient pas, seul le contraste de surface porte le relief.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full text-xs font-medium transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-3.5 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-[2px] focus-visible:ring-[var(--ring-soft)] focus-visible:ring-offset-0",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:opacity-90',
        // Jamais d'aplat : une action destructive se lit au contour, pas à la
        // teinte — le vermillon de marque en est trop proche pour qu'un aplat
        // rouge reste distinguable (cf. tokens, --destructive).
        destructive:
          'border border-[var(--destructive)]/50 text-destructive hover:bg-[var(--destructive-soft)] hover:border-[var(--destructive)]',
        outline:
          'border border-border bg-[var(--surface-2)] text-foreground hover:bg-[var(--surface-3)] hover:border-[var(--border-strong)]',
        secondary:
          'bg-[var(--surface-3)] text-foreground hover:bg-[var(--border-strong)]',
        ghost:
          'text-[var(--muted-foreground)] hover:bg-[var(--surface-2)] hover:text-foreground',
        link: 'text-foreground underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-7 px-3.5 has-[>svg]:px-3',
        sm: 'h-6 px-3 text-[11px] has-[>svg]:px-2.5',
        lg: 'h-8 px-4 has-[>svg]:px-3.5',
        icon: 'size-7',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : 'button'

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
