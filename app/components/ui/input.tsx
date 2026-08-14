import * as React from 'react'

import { cn } from '@/lib/utils'

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'file:text-foreground placeholder:text-[var(--subtle-foreground)] selection:bg-primary selection:text-primary-foreground border-border bg-[var(--surface-2)] text-foreground h-7 w-full min-w-0 rounded-lg border px-2.5 text-xs transition-colors duration-150 outline-none file:inline-flex file:h-5 file:border-0 file:bg-transparent file:text-xs file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        'hover:border-[var(--border-strong)] focus-visible:border-[var(--foreground)] focus-visible:ring-[2px] focus-visible:ring-[var(--ring-soft)]',
        'aria-invalid:border-destructive',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
