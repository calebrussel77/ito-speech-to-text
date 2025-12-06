import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/app/components/ui/tooltip'

// Premium theme constants (matching Pill.tsx)
const THEME = {
  background: {
    primary: 'hsl(225, 15%, 8%)',
  },
  border: {
    subtle: 'hsla(210, 20%, 96%, 0.08)',
  },
  glow: {
    idle: '0 4px 12px hsla(0, 0%, 0%, 0.4), 0 1px 4px hsla(0, 0%, 0%, 0.3)',
  },
  accent: {
    foreground: 'hsl(210, 20%, 96%)',
  },
}

interface TooltipButtonProps {
  onClick: (e: React.MouseEvent) => void
  icon: React.ReactNode
  tooltip: string
}

export const TooltipButton: React.FC<TooltipButtonProps> = ({
  onClick,
  icon,
  tooltip,
}) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <button
        onClick={onClick}
        style={{
          background: 'hsla(210, 20%, 96%, 0.06)',
          border: '1px solid hsla(210, 20%, 96%, 0.1)',
          borderRadius: '8px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '6px',
          transition: 'all 0.2s ease',
          backdropFilter: 'blur(4px)',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.background = 'hsla(210, 20%, 96%, 0.12)'
          e.currentTarget.style.borderColor = 'hsla(210, 20%, 96%, 0.2)'
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = 'hsla(210, 20%, 96%, 0.06)'
          e.currentTarget.style.borderColor = 'hsla(210, 20%, 96%, 0.1)'
        }}
      >
        {icon}
      </button>
    </TooltipTrigger>
    <TooltipContent
      side="top"
      style={{
        backgroundColor: THEME.background.primary,
        color: THEME.accent.foreground,
        padding: '6px 10px',
        fontSize: '12px',
        marginBottom: '8px',
        borderRadius: '6px',
        border: `1px solid ${THEME.border.subtle}`,
        boxShadow: THEME.glow.idle,
      }}
      className="border-none"
    >
      {tooltip}
    </TooltipContent>
  </Tooltip>
)
