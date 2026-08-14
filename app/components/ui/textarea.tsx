import * as React from 'react'

import { cn } from '@/lib/utils'

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'border-border bg-[var(--surface-2)] text-foreground placeholder:text-[var(--subtle-foreground)] hover:border-[var(--border-strong)] focus-visible:border-[var(--foreground)] focus-visible:ring-[2px] focus-visible:ring-[var(--ring-soft)] aria-invalid:border-destructive flex field-sizing-content min-h-14 w-full rounded-lg border px-2.5 py-1.5 text-xs transition-colors duration-150 outline-none disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }
