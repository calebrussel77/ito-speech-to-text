import { ES, FR, GB } from 'country-flag-icons/react/3x2'
import { Globe } from '@mynaui/icons-react'
import { cn } from '@/lib/utils'

/**
 * Le drapeau d'un pays, en SVG.
 *
 * Pas en emoji : Windows ne rend aucun emoji de drapeau et affiche les deux
 * lettres de l'indicateur régional à la place — c'est ce que faisait le
 * sélecteur de langue, et ça se voyait.
 *
 * Le catalogue de `country-flag-icons` couvre le monde entier ; seuls les pays
 * que l'app nomme réellement sont importés, pour que le reste ne parte pas
 * dans le bundle. En ajouter un se voit ici, et nulle part ailleurs.
 */
const FLAGS: Record<string, typeof FR> = { ES, FR, GB }

export default function FlagIcon({
  /** Code ISO 3166-1 alpha-2, ou `null` pour « pas de pays ». */
  country,
  className,
}: {
  country: string | null
  className?: string
}) {
  // Rien à dessiner : un globe, pas un vide — l'alignement de la ligne doit
  // tenir que la langue ait un pays ou non.
  if (!country) {
    return (
      <Globe
        className={cn('size-3.5 text-[var(--muted-foreground)]', className)}
      />
    )
  }

  const Flag = FLAGS[country]
  if (!Flag) return null

  return (
    <Flag
      // 3x2 : la hauteur suit la largeur, d'où le rapport figé plutôt qu'un
      // `size-*` qui déformerait le dessin.
      className={cn('w-4 shrink-0 rounded-[2px]', className)}
      title={country}
    />
  )
}
