import type { CatalogProvider } from '../../constants/modelCatalog'

/**
 * Quel transport prend l'audio.
 *
 * Le seuil n'est pas un réglage (décision D16) : c'est une limite technique,
 * pas une préférence. L'exposer inviterait à le régler au-delà de ce que le
 * transport supporte, ce qui échouerait après la dictée.
 */

/** 8 min ≈ 15 Mo de WAV, contre un plafond Groq de 25 Mo : une vraie marge. */
export const FILE_PATH_THRESHOLD_MS = 480_000

export const GROQ_MAX_BYTES = 25 * 1024 * 1024

/**
 * Au-delà, le corps JSON base64 devient déraisonnable : l'encodage gonfle de
 * 33 % et l'edge d'OpenRouter refuse les corps très gros.
 */
export const OPENROUTER_MAX_BYTES = 6 * 1024 * 1024

export type TranscriptionPath =
  | 'groq'
  | 'openrouter'
  | 'deepgram'
  | 'openai'
  | 'google'

export type RouterInput = {
  voiceModelProvider: CatalogProvider
  durationMs: number
  wavBytes: number
  /** Le mode demande la séparation des locuteurs. */
  identifySpeakers: boolean
  hasOpenRouterKey: boolean
  hasDeepgramKey: boolean
  hasOpenAIKey: boolean
  hasGoogleKey: boolean
}

export type RouterDecision =
  | { path: TranscriptionPath }
  | { path: null; reason: string }

/**
 * Ce que le transport du fournisseur courant accepte. Appliquer le plafond
 * base64 d'OpenRouter à Groq ramènerait le seuil effectif de 8 min à 3 min 17,
 * et ferait changer de moteur une dictée de 4 min sans que rien ne l'annonce.
 */
function transportCeiling(provider: CatalogProvider): number {
  return provider === 'openrouter' ? OPENROUTER_MAX_BYTES : GROQ_MAX_BYTES
}

export function chooseTranscriptionPath(input: RouterInput): RouterDecision {
  // Seul Deepgram rend `words[].speaker` : un mode qui demande la diarisation
  // n'a rien à faire sur les deux autres chemins, quelle que soit la durée.
  const wantsFilePath =
    input.durationMs >= FILE_PATH_THRESHOLD_MS ||
    input.wavBytes > transportCeiling(input.voiceModelProvider) ||
    input.identifySpeakers

  if (wantsFilePath && input.hasDeepgramKey) {
    return { path: 'deepgram' }
  }

  // Pas de clé Deepgram : on tente quand même le chemin court tant que la
  // taille passe. Une dictée transcrite par un moteur imparfait vaut mieux
  // qu'une dictée refusée.
  if (wantsFilePath && input.wavBytes <= GROQ_MAX_BYTES) {
    console.warn(
      '[transcriptionRouter] Long recording without a Deepgram key, falling back to Groq',
    )
    return { path: 'groq' }
  }

  if (wantsFilePath) {
    return {
      path: null,
      reason:
        'This recording is too long to transcribe without a Deepgram API key. Add one in Models.',
    }
  }

  // Chaque fournisseur du catalogue a son chemin ; sans sa clé, on retombe
  // sur Groq plutôt que de refuser la dictée — le sélecteur grise déjà ces
  // modèles, donc y arriver sans clé est un état transitoire, pas un choix.
  if (input.voiceModelProvider === 'openrouter') {
    if (!input.hasOpenRouterKey) {
      console.warn(
        '[transcriptionRouter] OpenRouter model without a key, falling back to Groq',
      )
      return { path: 'groq' }
    }
    return { path: 'openrouter' }
  }

  if (input.voiceModelProvider === 'deepgram') {
    if (!input.hasDeepgramKey) {
      console.warn(
        '[transcriptionRouter] Deepgram model without a key, falling back to Groq',
      )
      return { path: 'groq' }
    }
    return { path: 'deepgram' }
  }

  if (input.voiceModelProvider === 'openai') {
    if (!input.hasOpenAIKey) {
      console.warn(
        '[transcriptionRouter] OpenAI model without a key, falling back to Groq',
      )
      return { path: 'groq' }
    }
    return { path: 'openai' }
  }

  if (input.voiceModelProvider === 'google') {
    if (!input.hasGoogleKey) {
      console.warn(
        '[transcriptionRouter] Google model without a key, falling back to Groq',
      )
      return { path: 'groq' }
    }
    return { path: 'google' }
  }

  return { path: 'groq' }
}
