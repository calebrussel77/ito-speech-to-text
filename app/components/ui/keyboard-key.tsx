import { ComponentPropsWithoutRef } from 'react'
import clsx from 'clsx'
import { cx } from 'class-variance-authority'
import { KeyName, getKeyDisplayInfo } from '../../../lib/types/keyboard'
import { getDirectionalIndicator, getKeyDisplay } from '../../utils/keyboard'
import { usePlatform } from '../../hooks/usePlatform'

const FnKey = () => (
  <svg
    width="100%"
    height="100%"
    viewBox="0 0 80 80"
    xmlns="http://www.w3.org/2000/svg"
  >
    <g transform="translate(15, 46)">
      <circle
        cx="9"
        cy="9"
        r="8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <line
        x1="9"
        y1="1"
        x2="9"
        y2="17"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <line
        x1="1"
        y1="9"
        x2="17"
        y2="9"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path
        d="M9 1 C4.5 4.5 4.5 13.5 9 17"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
      />
      <path
        d="M9 1 C13.5 4.5 13.5 13.5 9 17"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
      />
      <path
        d="M2.5 5.5 C5.5 4.5 12.5 4.5 15.5 5.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
      />
      <path
        d="M2.5 12.5 C5.5 13.5 12.5 13.5 15.5 12.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
      />
    </g>
    <text
      x="56"
      y="28"
      fontFamily="Geist, system-ui, sans-serif"
      fontSize="16"
      fontWeight="400"
      fill="currentColor"
      textAnchor="middle"
    >
      fn
    </text>
  </svg>
)

const ModifierKey = ({
  keyboardKey,
  symbol,
  side,
  showDirectionalText = false,
}: {
  keyboardKey: string
  symbol: string
  side?: 'left' | 'right'
  showDirectionalText?: boolean
}) => (
  <svg
    width="100%"
    height="100%"
    viewBox="0 0 80 80"
    xmlns="http://www.w3.org/2000/svg"
  >
    {/* Symbol at the top */}
    <text
      x="40"
      y="22"
      fontFamily="Geist, system-ui, sans-serif"
      fontSize="18"
      fontWeight="400"
      fill="currentColor"
      textAnchor="middle"
    >
      {symbol}
    </text>

    {/* Name in the middle */}
    <text
      x="40"
      y="45"
      fontFamily="Geist, system-ui, sans-serif"
      fontSize="12"
      fontWeight="400"
      fill="currentColor"
      textAnchor="middle"
    >
      {keyboardKey}
    </text>

    {/* Direction indicator at the bottom */}
    {side && (
      <text
        x="40"
        y="62"
        fontFamily="Geist, system-ui, sans-serif"
        fontSize="10"
        fontWeight="400"
        fill="currentColor"
        opacity="0.6"
        textAnchor="middle"
      >
        {getDirectionalIndicator(side, showDirectionalText)}
      </text>
    )}
  </svg>
)

const DefaultKey = ({ keyboardKey }: { keyboardKey: string }) => {
  let label = keyboardKey
  if (/^[a-zA-Z]$/.test(label)) label = label.toUpperCase()
  let fontSize = 20
  if (label.length > 3) fontSize = 18
  if (label.length > 6) fontSize = 16
  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 0 80 80"
      xmlns="http://www.w3.org/2000/svg"
    >
      <text
        x="40"
        y="44"
        fontFamily="Geist, system-ui, sans-serif"
        fontSize={fontSize}
        fontWeight="400"
        fill="currentColor"
        textAnchor="middle"
      >
        {label}
      </text>
    </svg>
  )
}

const KeyToRender = ({
  keyboardKey,
  showDirectionalText = false,
  platform = 'darwin',
}: {
  keyboardKey: KeyName
  showDirectionalText?: boolean
  platform?: 'darwin' | 'win32'
}) => {
  if (keyboardKey === 'fn' || keyboardKey === 'fn_fast') {
    return <FnKey />
  }

  const displayInfo = getKeyDisplayInfo(keyboardKey, platform)

  if (displayInfo.isModifier && displayInfo.symbol) {
    return (
      <ModifierKey
        keyboardKey={displayInfo.label}
        symbol={displayInfo.symbol}
        side={displayInfo.side}
        showDirectionalText={showDirectionalText}
      />
    )
  }

  return <DefaultKey keyboardKey={keyboardKey} />
}

/* ---------------- Component ---------------- */

interface KeyboardKeyProps extends ComponentPropsWithoutRef<'div'> {
  keyboardKey: KeyName
  /** 'tile' = big square SVG (default). 'inline' = small pill for rows/inline usage. */
  variant?: 'tile' | 'inline'
  /** Optional compact size for the tile variant */
  size?: 'md' | 'sm'
  /** Whether to show directional text (left/right) for modifier keys. Default: false */
  showDirectionalText?: boolean
}

export default function KeyboardKey({
  keyboardKey,
  className,
  variant = 'tile',
  showDirectionalText = false,
  ...props
}: KeyboardKeyProps) {
  const platform = usePlatform()

  if (variant === 'inline') {
    const display = getKeyDisplay(keyboardKey, platform, {
      showDirectionalText,
      format: 'symbol',
    })

    return (
      <span
        className={clsx(
          'inline-flex select-none items-center justify-center rounded-md border border-border',
          'bg-[var(--surface-3)] px-1.5 py-0.5 font-mono text-[11px] leading-4 text-foreground',
          className,
        )}
        {...props}
      >
        {display}
      </span>
    )
  }

  return (
    <div
      className={cx(
        'rounded-lg border border-border bg-[var(--surface-3)] text-[var(--muted-foreground)]',
        className,
      )}
      {...props}
    >
      <KeyToRender
        keyboardKey={keyboardKey}
        showDirectionalText={showDirectionalText}
        platform={platform}
      />
    </div>
  )
}
