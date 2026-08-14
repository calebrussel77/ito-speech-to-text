/**
 * Les langues qu'un mode peut imposer.
 *
 * `auto` est délibérément en dernier : l'indice de langue améliore
 * mesurablement la précision du moteur vocal, donc la détection automatique
 * est un repli, pas un défaut recommandé.
 */
export type ModeLanguage = 'fr' | 'en' | 'es' | 'auto'

export const MODE_LANGUAGES: {
  key: ModeLanguage
  label: string
  flag: string
}[] = [
  { key: 'fr', label: 'French', flag: '🇫🇷' },
  { key: 'en', label: 'English', flag: '🇬🇧' },
  { key: 'es', label: 'Spanish', flag: '🇪🇸' },
  { key: 'auto', label: 'Automatic', flag: '🌐' },
]

export const DEFAULT_MODE_LANGUAGE: ModeLanguage = 'fr'

/** Le nom en toutes lettres, pour l'imposer au LLM. `auto` n'en a pas. */
export const LANGUAGE_NAMES: Record<Exclude<ModeLanguage, 'auto'>, string> = {
  fr: 'French',
  en: 'English',
  es: 'Spanish',
}

/** L'indice ISO-639-1 envoyé au moteur vocal. `auto` n'en envoie aucun. */
export function asrLanguageHint(language: ModeLanguage): string | undefined {
  return language === 'auto' ? undefined : language
}
