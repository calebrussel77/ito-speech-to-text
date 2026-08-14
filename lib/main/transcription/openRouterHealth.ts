import crypto from 'crypto'
import store, { getAdvancedSettings } from '../store'
import { STORE_KEYS } from '../../constants/store-keys'

/**
 * Why the last OpenRouter transcription failed, kept in the settings so the
 * reason outlives the notification that announced it.
 *
 * A refused key is the one failure that cannot fix itself: retrying it costs
 * ten seconds of upload per long dictation and always ends the same way. The
 * fingerprint is what makes suppressing those retries safe — it pins the
 * record to the key that earned it, so saving a different key silently makes
 * the record stale instead of requiring anyone to clear it.
 */
export type OpenRouterFailure = {
  code: string
  message: string
  /** Model slug that was being called. */
  model: string
  at: string
  keyFingerprint: string
}

const FAILURE_PATH = `${STORE_KEYS.ADVANCED_SETTINGS}.openRouterFailure`

const FAILURE_NOTICES: Record<string, string> = {
  INVALID_API_KEY:
    'Clé OpenRouter refusée. Les dictées longues restent sur Groq tant qu’elle n’est pas corrigée dans Settings → Models.',
  MISSING_API_KEY:
    'Aucune clé OpenRouter enregistrée ; la dictée est transcrite par Groq.',
  RATE_LIMIT: 'Quota OpenRouter atteint ; la dictée est transcrite par Groq.',
  NETWORK: 'OpenRouter injoignable ; la dictée est transcrite par Groq.',
  MODEL_ERROR:
    'OpenRouter a refusé la requête ; la dictée est transcrite par Groq.',
}

/** Codes that will keep failing until the user changes something. */
const PERMANENT_CODES = new Set(['INVALID_API_KEY'])

const fingerprint = (apiKey: string) =>
  crypto.createHash('sha256').update(apiKey.trim()).digest('hex').slice(0, 16)

export function failureNotice(code?: string): string {
  return (
    (code && FAILURE_NOTICES[code]) ||
    'La transcription OpenRouter a échoué ; la dictée est transcrite par Groq.'
  )
}

/**
 * The stored failure, but only when it still describes the key in use — a
 * record left behind by a key that has since been replaced says nothing about
 * the current one.
 */
export function getOpenRouterFailure(
  apiKey?: string,
): OpenRouterFailure | null {
  const stored = (getAdvancedSettings() as any)?.openRouterFailure as
    | OpenRouterFailure
    | undefined
  if (!stored?.code) return null
  const key = apiKey?.trim()
  if (!key || stored.keyFingerprint !== fingerprint(key)) return null
  return stored
}

/**
 * The failure worth skipping the next call for. Transient ones (rate limit,
 * network, a model erroring once) return null: those deserve another try.
 */
export function getRejectedKeyFailure(
  apiKey?: string,
): OpenRouterFailure | null {
  const failure = getOpenRouterFailure(apiKey)
  return failure && PERMANENT_CODES.has(failure.code) ? failure : null
}

export function recordOpenRouterFailure(params: {
  code: string
  message: string
  model: string
  apiKey: string
}) {
  const failure: OpenRouterFailure = {
    code: params.code,
    message: params.message,
    model: params.model,
    at: new Date().toISOString(),
    keyFingerprint: fingerprint(params.apiKey),
  }
  try {
    store.set(FAILURE_PATH, failure)
  } catch (error) {
    console.warn('[openRouterHealth] Could not persist the failure:', error)
  }
}

export function clearOpenRouterFailure() {
  try {
    if ((getAdvancedSettings() as any)?.openRouterFailure) {
      store.set(FAILURE_PATH, null)
    }
  } catch (error) {
    console.warn('[openRouterHealth] Could not clear the failure:', error)
  }
}
