'use client'

import * as React from 'react'
import * as SwitchPrimitive from '@radix-ui/react-switch'

import { cn } from '@/lib/utils'

function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'peer data-[state=checked]:bg-primary data-[state=unchecked]:bg-[var(--surface-3)] data-[state=unchecked]:border-border focus-visible:ring-[var(--ring-soft)] inline-flex h-4 w-7 shrink-0 items-center rounded-full border border-transparent px-px transition-colors duration-150 outline-none focus-visible:ring-[2px] disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          'data-[state=unchecked]:bg-[var(--muted-foreground)] data-[state=checked]:bg-primary-foreground pointer-events-none block size-3 rounded-full ring-0 transition-transform duration-150 data-[state=checked]:translate-x-3 data-[state=unchecked]:translate-x-0',
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
