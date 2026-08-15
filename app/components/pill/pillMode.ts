/**
 * Quel mode la pill montre, et d'où elle tient son identité.
 *
 * Extrait du composant parce que c'est la seule vraie décision qu'il prend, et
 * que sa règle a une subtilité qui s'est déjà payée : le **traitement fait
 * partie de la dictée**. Le processus principal diffuse l'arrêt de
 * l'enregistrement (`notifyRecordingStopped`) puis le début du traitement
 * (`notifyProcessingStarted`) en deux messages distincts ; tenir la première
 * pour la fin du cycle faisait retomber la pill sur le mode actif pendant toute
 * la transcription — donc sur la mauvaise icône et la mauvaise couleur.
 *
 * La diffusion l'emporte sur le cache du store des modes : elle vient d'être
 * lue en base, alors que le cache n'est rafraîchi que pour le mode actif. Un
 * mode dicté par raccourci dédié n'est pas le mode actif.
 */
export interface PillModeState {
  /** Enregistrement en cours, manuel ou par raccourci. */
  recording: boolean
  /** Transcription en cours. Compte comme la même dictée. */
  processing: boolean
  /** Ce que la dernière diffusion de démarrage a dit du mode qui dicte. */
  broadcast: { id: string; icon: string; color: string }
  /** Le mode actif, tel que le store le connaît. */
  active: { id?: string; icon?: string }
}

export interface PillMode {
  /** Id à utiliser pour dériver une teinte, ou `undefined` si aucun mode. */
  id: string | undefined
  /** Nom d'icône à rendre, ou `null` si aucun mode n'est connu. */
  icon: string | null
  /** Teinte choisie du mode, ou `null` : à l'appelant de la dériver de `id`. */
  color: string | null
}

export function pillMode({
  recording,
  processing,
  broadcast,
  active,
}: PillModeState): PillMode {
  const dictating = recording || processing

  return {
    id: (dictating && broadcast.id) || active.id,
    icon: (dictating && broadcast.icon) || active.icon || null,
    color: (dictating && broadcast.color) || null,
  }
}
