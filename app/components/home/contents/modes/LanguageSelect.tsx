import { MODE_LANGUAGES } from '@/lib/constants/modeLanguages'
import type { ModeLanguage } from '@/lib/constants/modeLanguages'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/app/components/ui/select'
import { CONTROL_WIDTH } from '@/app/components/ui/settings'
import FlagIcon from '@/app/components/icons/FlagIcon'

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
    <Select
      value={value}
      onValueChange={language => onChange(language as ModeLanguage)}
    >
      <SelectTrigger className={CONTROL_WIDTH}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {MODE_LANGUAGES.map(language => (
          <SelectItem key={language.key} value={language.key}>
            <FlagIcon country={language.country} />
            {language.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
