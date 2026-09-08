import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Ce qu'Electron `safeStorage` fait sous Windows, refait hors Electron.
 *
 * Les clés API d'Ito sont chiffrées sur disque comme dans Chromium : une clé
 * AES-256 protégée par DPAPI (session Windows de l'utilisateur) dans
 * `Local State`, puis chaque valeur en AES-GCM, préfixée « v10 ». Un
 * processus lancé par le même utilisateur peut donc les lire, sans rien
 * ressaisir. DPAPI est appelé via PowerShell : quelques dizaines de
 * millisecondes, aucun binding natif à maintenir.
 */
const VERSION_PREFIX = 'v10'
const DPAPI_PREFIX = 'DPAPI'
const NONCE_BYTES = 12
const TAG_BYTES = 16

export type SafeStorageLike = {
  isEncryptionAvailable: () => boolean
  decryptString: (encrypted: Buffer) => string
  encryptString?: (plain: string) => Buffer
}

function unprotectWithDpapi(protectedBytes: Buffer): Buffer {
  const shell = process.platform === 'win32' ? 'powershell' : 'pwsh'
  const script = [
    'Add-Type -AssemblyName System.Security',
    `$bytes = [Convert]::FromBase64String('${protectedBytes.toString('base64')}')`,
    "[Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, 'CurrentUser'))",
  ].join('; ')
  const output = execFileSync(
    shell,
    ['-NoProfile', '-NonInteractive', '-Command', script],
    {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 15_000,
    },
  )
  return Buffer.from(output.trim(), 'base64')
}

/** La clé AES d'un profil Ito, déchiffrée une fois par processus. */
function loadMasterKey(userDataDir: string): Buffer {
  const localState = JSON.parse(
    fs.readFileSync(path.join(userDataDir, 'Local State'), 'utf8'),
  )
  const encoded: string | undefined = localState?.os_crypt?.encrypted_key
  if (!encoded) throw new Error('No os_crypt.encrypted_key in Local State')
  const wrapped = Buffer.from(encoded, 'base64')
  if (wrapped.subarray(0, DPAPI_PREFIX.length).toString() !== DPAPI_PREFIX) {
    throw new Error('Unexpected os_crypt key format')
  }
  return unprotectWithDpapi(wrapped.subarray(DPAPI_PREFIX.length))
}

export function decryptV10(masterKey: Buffer, encrypted: Buffer): string {
  if (
    encrypted.subarray(0, VERSION_PREFIX.length).toString() !== VERSION_PREFIX
  ) {
    throw new Error('Unexpected ciphertext format')
  }
  const nonce = encrypted.subarray(
    VERSION_PREFIX.length,
    VERSION_PREFIX.length + NONCE_BYTES,
  )
  const body = encrypted.subarray(VERSION_PREFIX.length + NONCE_BYTES)
  const tag = body.subarray(body.length - TAG_BYTES)
  const data = body.subarray(0, body.length - TAG_BYTES)
  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, nonce)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    'utf8',
  )
}

/**
 * Un `safeStorage` pour le profil donné. Le déchiffrement échoue en bloc ou
 * pas du tout ; en cas d'échec, `isEncryptionAvailable` rend false et le
 * store garde les valeurs telles quelles — le repli par variables
 * d'environnement prend alors le relais (voir `applyApiKeyOverrides`).
 */
export function createSafeStorage(userDataDir: string): SafeStorageLike {
  let masterKey: Buffer | null | undefined
  const key = () => {
    if (masterKey === undefined) {
      try {
        masterKey = loadMasterKey(userDataDir)
      } catch (error: any) {
        console.warn(
          `[ito-transcribe] Cannot unlock the Ito API keys (${error?.message}); set ITO_*_API_KEY variables instead.`,
        )
        masterKey = null
      }
    }
    return masterKey
  }
  return {
    isEncryptionAvailable: () => process.platform === 'win32' && key() !== null,
    decryptString: encrypted => decryptV10(key()!, encrypted),
  }
}
