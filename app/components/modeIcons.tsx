import {
  Microphone,
  Sparkles,
  UsersGroup,
  MessageDots,
  Envelope,
  SquareDashed,
} from '@mynaui/icons-react'
import type { ComponentType } from 'react'

/**
 * Les icônes que `modes.icon` peut nommer.
 *
 * La colonne stocke un nom, pas un composant : une icône inconnue (mode créé
 * par une version future, ou renommage côté paquet) tombe sur `SquareDashed`
 * plutôt que de faire planter la liste.
 */
export const MODE_ICONS: Record<
  string,
  ComponentType<{ className?: string }>
> = {
  Microphone,
  Sparkles,
  UsersGroup,
  MessageDots,
  Envelope,
  SquareDashed,
}

export function modeIcon(name: string) {
  return MODE_ICONS[name] ?? SquareDashed
}
