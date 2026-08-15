import { MODE_COLORS } from '@/lib/constants/modeColors'
import { cn } from '@/lib/utils'

/**
 * Le choix de teinte d'un mode.
 *
 * La charte n'autorise la couleur qu'en pastille de 6 px — c'est la règle
 * d'affichage, et elle tient partout ailleurs (liste, éditeur, pill). Ici, la
 * couleur EST le contenu du contrôle : une pastille de 6 px serait intouchable
 * à la souris. Les échantillons font donc 16 px, et cette exception s'arrête à
 * ce sélecteur.
 *
 * `null` n'est pas une absence de couleur mais un choix : « celle que l'app
 * dérive de ce mode ». D'où le neuvième échantillon, qui montre cette teinte
 * dérivée sous un anneau pointillé plutôt que de laisser deviner.
 */
export default function ModeColorPicker({
  value,
  derived,
  onChange,
}: {
  /** Teinte choisie, ou `null` pour « dérivée ». */
  value: string | null
  /** La teinte que le mode prendrait sans choix explicite. */
  derived: string
  onChange: (color: string | null) => void
}) {
  const swatch = (color: string, selected: boolean, auto: boolean) => (
    <button
      key={auto ? 'auto' : color}
      type="button"
      title={auto ? 'Automatic' : color}
      aria-label={auto ? 'Automatic colour' : `Colour ${color}`}
      aria-pressed={selected}
      onClick={() => onChange(auto ? null : color)}
      className={cn(
        'size-4 rounded-full transition-shadow duration-150',
        auto && 'border border-dashed border-border-strong',
        selected &&
          'ring-foreground ring-offset-background ring-2 ring-offset-2',
      )}
      style={{ backgroundColor: auto ? `${derived}40` : color }}
    />
  )

  return (
    <div className="flex items-center gap-2">
      {MODE_COLORS.map(color => swatch(color, value === color, false))}
      {swatch(derived, value === null, true)}
    </div>
  )
}
