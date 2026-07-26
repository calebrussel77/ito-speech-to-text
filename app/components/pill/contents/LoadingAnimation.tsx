import React from 'react'

const THEME = {
  accent: {
    foreground: 'hsl(210, 20%, 96%)',
  },
}

interface LoadingAnimationProps {
  color?: string
}

// Three small dots pulsing in sequence — compact enough for the small pill
export const LoadingAnimation: React.FC<LoadingAnimationProps> = ({
  color = THEME.accent.foreground,
}) => {
  return (
    <>
      <style>{`
        @keyframes dotPulse {
          0%, 80%, 100% {
            opacity: 0.25;
            transform: scale(0.8);
          }
          40% {
            opacity: 1;
            transform: scale(1);
          }
        }
      `}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
        {[0, 1, 2].map(i => (
          <span
            key={i}
            style={{
              width: '4px',
              height: '4px',
              borderRadius: '50%',
              backgroundColor: color,
              animation: `dotPulse 1.2s ease-in-out ${i * 0.16}s infinite`,
            }}
          />
        ))}
      </div>
    </>
  )
}
