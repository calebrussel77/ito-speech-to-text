#!/usr/bin/env bun
/**
 * ito-transcribe : les enregistrements d'un dossier (appels, réunions)
 * transcrits par les moteurs d'Ito, un Markdown par fichier, lisible par
 * un agent. Tourne sans que l'app Ito soit lancée : il lit son profil
 * (clés, modèle fichier, dictionnaire, langue) et écrit dans son historique.
 *
 * L'ordre compte : les cales `electron` doivent être en place avant que le
 * moindre module de `lib/` ne soit chargé, d'où l'import dynamique.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { format } from 'node:util'
import { HELP, parseCliArgs, type CliOptions } from './args'

// La sortie standard est réservée au rapport (texte ou JSON) : le journal
// du pipeline, écrit avec console.log, passe sur stderr.
console.log = (...args: unknown[]) => {
  process.stderr.write(`${format(...args)}\n`)
}
console.info = console.log

let options: CliOptions
try {
  options = parseCliArgs(process.argv.slice(2))
} catch (error: any) {
  process.stderr.write(`${error?.message ?? error}\n\n${HELP}`)
  process.exit(2)
}
if (options.help || options.inputs.length === 0) {
  process.stdout.write(HELP)
  process.exit(options.help ? 0 : 2)
}

const appData =
  process.env.APPDATA ??
  (process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Application Support')
    : path.join(os.homedir(), '.config'))
const userDataDir = path.join(appData, `Ito-${options.env}`)
if (!fs.existsSync(path.join(userDataDir, 'ito.db'))) {
  process.stderr.write(
    `No Ito profile at ${userDataDir}. Install Ito and add your API keys in Settings › Models first.\n`,
  )
  process.exit(2)
}

const { installShims } = await import('./shims')
const { createSafeStorage } = await import('./safeStorage')
const { version } = JSON.parse(
  fs.readFileSync(path.join(import.meta.dir, '..', 'package.json'), 'utf8'),
)
installShims({
  userDataDir,
  safeStorage: createSafeStorage(userDataDir),
  version,
})

const { run } = await import('./run')
const code = await run(options)
process.exit(code)
