import { ReactNode } from 'react'
import { Tooltip, TooltipTrigger, TooltipContent } from './tooltip'

interface NavItemProps {
  icon: ReactNode
  label: string
  isActive?: boolean
  showText: boolean
  onClick?: () => void
}

export function NavItem({
  icon,
  label,
  isActive = false,
  showText,
  onClick,
}: NavItemProps) {
  const navContent = (
    <div
      className={`flex items-center px-3 py-2.5 mb-1 rounded-lg cursor-pointer transition-all duration-200 group ${
        isActive
          ? 'bg-primary text-primary-foreground shadow-sm font-medium'
          : 'text-muted-foreground hover:bg-secondary hover:text-secondary-foreground'
      }`}
      onClick={onClick}
    >
      <div
        className={`w-6 flex items-center justify-center transition-colors ${isActive ? 'text-primary-foreground' : 'text-foreground/70 group-hover:text-foreground'}`}
      >
        {icon}
      </div>
      <span
        className={`whitespace-nowrap transition-all duration-300 ${
          showText ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-2'
        } ${showText ? 'ml-3' : 'w-0 overflow-hidden'}`}
      >
        {label}
      </span>
    </div>
  )

  if (!showText) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{navContent}</TooltipTrigger>
        <TooltipContent side="right" sideOffset={2} className="text-sm">
          {label}
        </TooltipContent>
      </Tooltip>
    )
  }

  return navContent
}
