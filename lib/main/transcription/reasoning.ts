/**
 * Retire le raisonnement inline (`<think>…</think>`) de la réponse d'un
 * modèle texte.
 *
 * OpenRouter promet le raisonnement dans un champ séparé
 * (`message.reasoning`), mais certains hôtes Qwen le collent malgré tout dans
 * `content` — constaté le 2026-08-15 : une dictée d'une phrase insérait
 * quatre pages de monologue interne avant le texte. Ce nettoyage est la
 * garantie de sortie ; `reasoning: { exclude: true }` dans la requête n'est
 * que le vœu d'entrée, que l'hôte fautif ignore précisément.
 *
 * Une balise ouverte jamais refermée (pensée tronquée par `max_tokens`)
 * emporte tout ce qui la suit : il n'y a pas de réponse dedans, et rendre ''
 * fait retomber l'appelant sur le transcript brut — le bon repli.
 */
export function stripReasoning(text: string): string {
  return text
    .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/g, '')
    .replace(/<think(?:ing)?>[\s\S]*$/, '')
    .trim()
}
