import { MODE_LANGUAGES } from '@/lib/constants/modeLanguages'
import type { ModeLanguage } from '@/lib/constants/modeLanguages'
import { CONTROL_WIDTH } from '@/app/components/ui/settings'
import { cn } from '@/lib/utils'

/**
 * Le drapeau porte l'information plus vite que le libellé, mais ne la porte
 * pas seule : « Automatic » n'a pas de pays, et un drapeau isolé confond
 * langue et nation. Les deux sont donc toujours affichés ensemble.
 */
export default function LanguageSelect({
  value,
  onChange,
}: {
  value: ModeLanguage
  onChange: (language: ModeLanguage) => void
}) {
  return (
    <select
      value={value}
      onChange={event => onChange(event.target.value as ModeLanguage)}
      className={cn(
        'rounded-lg border border-border bg-transparent px-2 py-1 text-xs text-foreground',
        CONTROL_WIDTH,
      )}
    >
      {MODE_LANGUAGES.map(language => (
        <option key={language.key} value={language.key}>
          {language.flag} {language.label}
        </option>
      ))}
    </select>
  )
}
