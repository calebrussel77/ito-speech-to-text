import {
  Microphone,
  Sparkles,
  UsersGroup,
  MessageDots,
  Envelope,
  SquareDashed,
} from '@mynaui/icons-react'
import type { MynaIconsProps } from '@mynaui/icons-react'
import type { ComponentType } from 'react'

/**
 * Les icônes que `modes.icon` peut nommer.
 *
 * La colonne stocke un nom, pas un composant : une icône inconnue (mode créé
 * par une version future, ou renommage côté paquet) tombe sur `SquareDashed`
 * plutôt que de faire planter la liste.
 *
 * Partagé entre la fenêtre principale et celle de la pill — d'où la place à la
 * racine des composants, et le type complet des props : la pill n'a pas de
 * feuille de style et doit dimensionner et colorer ses icônes en `width` /
 * `height` / `color`, jamais en classes.
 */
export const MODE_ICONS: Record<string, ComponentType<MynaIconsProps>> = {
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
