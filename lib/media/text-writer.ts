import { execFile } from 'child_process'
import { platform, arch } from 'os'
import { getNativeBinaryPath } from './native-interface'
import store from '../main/store'
import { STORE_KEYS } from '../constants/store-keys'

interface TextWriterOptions {
  delay: number // Delay before typing (milliseconds)
  charDelay: number // Delay between characters (milliseconds)
}

const nativeModuleName = 'text-writer'

export function setFocusedText(
  text: string,
  options: TextWriterOptions = { delay: 0, charDelay: 0 },
): Promise<boolean> {
  return new Promise(resolve => {
    const binaryPath = getNativeBinaryPath(nativeModuleName)
    if (!binaryPath) {
      console.error(
        `Cannot determine ${nativeModuleName} binary path for platform ${platform()} and arch ${arch()}`,
      )
      return resolve(false)
    }

    // Read preferred paste combo from settings (default to auto)
    const settings = store.get(STORE_KEYS.SETTINGS) as any
    const pasteCombo: string = settings?.pasteCombo || 'auto'

    const args: string[] = []

    // Add optional arguments
    if (options.delay !== undefined) {
      args.push('--delay', options.delay.toString())
    }
    if (options.charDelay !== undefined) {
      args.push('--char-delay', options.charDelay.toString())
    }

    // Add the text as the final argument with -- separator to prevent flag parsing
    args.push('--', text)

    execFile(
      binaryPath,
      args,
      {
        env: {
          ...process.env,
          ITO_PASTE_COMBO: pasteCombo,
        },
      },
      (err, _stdout, stderr) => {
        if (err) {
          console.error('text-writer error:', stderr)
          return resolve(false)
        }
        resolve(true)
      },
    )
  })
}
