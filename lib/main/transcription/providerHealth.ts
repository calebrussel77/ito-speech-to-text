import crypto from 'crypto'
import store, { getAdvancedSettings } from '../store'
import { STORE_KEYS } from '../../constants/store-keys'

/**
 * A secondary transcription provider that can refuse a key exactly like
 * OpenRouter — currently just the two, but the type keeps the set explicit
 * rather than a bare string.
 */
export type Provider = 'openrouter' | 'deepgram'

/**
 * Why the last transcription on a given provider failed, kept in the
 * settings so the reason outlives the notification that announced it.
 *
 * A refused key is the one failure that cannot fix itself: retrying it costs
 * ten seconds of upload per long dictation and always ends the same way. The
 * fingerprint is what makes suppressing those retries safe — it pins the
 * record to the key that earned it, so saving a different key silently makes
 * the record stale instead of requiring anyone to clear it.
 */
export type ProviderFailure = {
  code: string
  message: string
  /** Model slug that was being called. */
  model: string
  at: string
  keyFingerprint: string
}

const PROVIDER_LABELS: Record<Provider, string> = {
  openrouter: 'OpenRouter',
  deepgram: 'Deepgram',
}

const failurePath = (provider: Provider) =>
  `${STORE_KEYS.ADVANCED_SETTINGS}.providerFailures.${provider}`

const FAILURE_NOTICES: Record<string, (label: string) => string> = {
  INVALID_API_KEY: label =>
    `Clé ${label} refusée. Les dictées longues restent sur Groq tant qu’elle n’est pas corrigée dans Settings → Models.`,
  MISSING_API_KEY: label =>
    `Aucune clé ${label} enregistrée ; la dictée est transcrite par Groq.`,
  RATE_LIMIT: label =>
    `Quota ${label} atteint ; la dictée est transcrite par Groq.`,
  NETWORK: label => `${label} injoignable ; la dictée est transcrite par Groq.`,
  MODEL_ERROR: label =>
    `${label} a refusé la requête ; la dictée est transcrite par Groq.`,
}

/** Codes that will keep failing until the user changes something. */
const PERMANENT_CODES = new Set(['INVALID_API_KEY'])

const fingerprint = (apiKey: string) =>
  crypto.createHash('sha256').update(apiKey.trim()).digest('hex').slice(0, 16)

export function failureNotice(provider: Provider, code?: string): string {
  const label = PROVIDER_LABELS[provider]
  const template = code && FAILURE_NOTICES[code]
  return template
    ? template(label)
    : `La transcription ${label} a échoué ; la dictée est transcrite par Groq.`
}

/**
 * The stored failure for a provider, straight from the settings — before the
 * fingerprint check that decides whether it still describes the key in use.
 */
function storedFailure(provider: Provider): ProviderFailure | undefined {
  const advanced = getAdvancedSettings() as any
  const failures = advanced?.providerFailures
  if (provider === 'openrouter') {
    // `clearProviderFailure` cannot delete a key — the store's `deepSet` only
    // ever overwrites — so a cleared record lives on as an *explicit* `null`
    // under `providerFailures.openrouter`, not as an absent key. That explicit
    // entry must win over the legacy field below, including when its value is
    // `null`: `??` would treat `null` as "nothing here" and fall through to
    // the stale legacy record forever, which is exactly the bug this guards
    // against (a fixed key would never stop being reported as rejected).
    // `in` is what tells "present but null" apart from "never written".
    if (failures && 'openrouter' in failures) {
      return failures.openrouter ?? undefined
    }
    // Forme héritée : le réglage portait un seul objet, implicitement
    // OpenRouter, avant que Deepgram ne rejoigne les fournisseurs pouvant
    // refuser une clé. Les installations existantes gardent cette forme tant
    // qu'aucune entrée (même un `null` explicite) n'existe dans
    // `providerFailures.openrouter`.
    return advanced?.openRouterFailure ?? undefined
  }
  return failures?.[provider]
}

/**
 * The stored failure, but only when it still describes the key in use — a
 * record left behind by a key that has since been replaced says nothing about
 * the current one.
 */
export function getProviderFailure(
  provider: Provider,
  apiKey?: string,
): ProviderFailure | null {
  const stored = storedFailure(provider)
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
  provider: Provider,
  apiKey?: string,
): ProviderFailure | null {
  const failure = getProviderFailure(provider, apiKey)
  return failure && PERMANENT_CODES.has(failure.code) ? failure : null
}

export function recordProviderFailure(params: {
  provider: Provider
  code: string
  message: string
  model: string
  apiKey: string
}) {
  const failure: ProviderFailure = {
    code: params.code,
    message: params.message,
    model: params.model,
    at: new Date().toISOString(),
    keyFingerprint: fingerprint(params.apiKey),
  }
  try {
    store.set(failurePath(params.provider), failure)
  } catch (error) {
    console.warn('[providerHealth] Could not persist the failure:', error)
  }
}

export function clearProviderFailure(provider: Provider) {
  try {
    if (storedFailure(provider)) {
      store.set(failurePath(provider), null)
    }
  } catch (error) {
    console.warn('[providerHealth] Could not clear the failure:', error)
  }
}
