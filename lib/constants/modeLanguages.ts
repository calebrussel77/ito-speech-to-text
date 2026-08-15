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
  /**
   * Code ISO 3166-1 alpha-2 du drapeau à dessiner, ou `null` quand la langue
   * n'a pas de pays (`auto`).
   *
   * C'était un emoji drapeau, remplacé par un code : Windows ne rend aucun
   * emoji de drapeau — il affiche les deux lettres de l'indicateur régional à
   * la place. Le dessin est donc fait en SVG côté interface.
   */
  country: string | null
}[] = [
  { key: 'fr', label: 'French', country: 'FR' },
  { key: 'en', label: 'English', country: 'GB' },
  { key: 'es', label: 'Spanish', country: 'ES' },
  { key: 'auto', label: 'Automatic', country: null },
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
