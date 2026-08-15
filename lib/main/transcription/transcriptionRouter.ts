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

export type TranscriptionPath = 'groq' | 'openrouter' | 'deepgram'

export type RouterInput = {
  voiceModelProvider: 'groq' | 'openrouter'
  durationMs: number
  wavBytes: number
  /** Le mode demande la séparation des locuteurs. */
  identifySpeakers: boolean
  hasOpenRouterKey: boolean
  hasDeepgramKey: boolean
}

export type RouterDecision =
  | { path: TranscriptionPath }
  | { path: null; reason: string }

/**
 * Ce que le transport du fournisseur courant accepte. Appliquer le plafond
 * base64 d'OpenRouter à Groq ramènerait le seuil effectif de 8 min à 3 min 17,
 * et ferait changer de moteur une dictée de 4 min sans que rien ne l'annonce.
 */
function transportCeiling(provider: 'groq' | 'openrouter'): number {
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

  if (input.voiceModelProvider === 'openrouter') {
    if (!input.hasOpenRouterKey) {
      console.warn(
        '[transcriptionRouter] OpenRouter model without a key, falling back to Groq',
      )
      return { path: 'groq' }
    }
    return { path: 'openrouter' }
  }

  return { path: 'groq' }
}
