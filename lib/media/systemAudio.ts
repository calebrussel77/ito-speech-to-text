import { execSync, spawn, ChildProcess } from 'child_process'
import log from 'electron-log'
import os from 'os'

let previousVolume: number | null = null

/**
 * Windows implementation: a persistent hidden PowerShell process drives the
 * master mute through the CoreAudio COM API (IAudioEndpointVolume). Keeping
 * the process alive avoids paying the ~1s Add-Type compilation on every
 * dictation — after warmup, mute/unmute are near-instant stdin writes.
 *
 * The mute state machine lives inside the script itself: it remembers
 * whether WE muted and whether the user was already muted, so "unmute"
 * never unmutes a system the user had muted manually. If the app dies
 * while muted, the script's finally block restores the previous state.
 */
const WINDOWS_MUTE_SCRIPT = `
Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int f(); int g(); int h(); int i();
  int SetMasterVolumeLevelScalar(float fLevel, System.Guid pguidEventContext);
  int j();
  int GetMasterVolumeLevelScalar(out float pfLevel);
  int k(); int l(); int m(); int n();
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, System.Guid pguidEventContext);
  int GetMute(out bool pbMute);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
  int Activate(ref System.Guid id, int clsCtx, int activationParams, out IAudioEndpointVolume aev);
}
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
  int f();
  int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
}
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorComObject { }
public class Audio {
  static IAudioEndpointVolume Vol() {
    var enumerator = new MMDeviceEnumeratorComObject() as IMMDeviceEnumerator;
    IMMDevice dev = null;
    Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, 1, out dev));
    IAudioEndpointVolume epv = null;
    var epvid = typeof(IAudioEndpointVolume).GUID;
    Marshal.ThrowExceptionForHR(dev.Activate(ref epvid, 23, 0, out epv));
    return epv;
  }
  public static bool Mute {
    get { bool mute; Marshal.ThrowExceptionForHR(Vol().GetMute(out mute)); return mute; }
    set { Marshal.ThrowExceptionForHR(Vol().SetMute(value, System.Guid.Empty)); }
  }
}
'@
$itoMuted = $false
$prevMuted = $false
try {
  while (($line = [Console]::In.ReadLine()) -ne $null) {
    $cmd = $line.Trim()
    if ($cmd -eq 'mute') {
      if (-not $itoMuted) {
        $prevMuted = [Audio]::Mute
        [Audio]::Mute = $true
        $itoMuted = $true
      }
    } elseif ($cmd -eq 'unmute') {
      if ($itoMuted) {
        if (-not $prevMuted) { [Audio]::Mute = $false }
        $itoMuted = $false
      }
    } elseif ($cmd -eq 'exit') {
      break
    }
  }
} finally {
  if ($itoMuted -and -not $prevMuted) { [Audio]::Mute = $false }
}
`

let windowsMuteProcess: ChildProcess | null = null

function getWindowsMuteProcess(): ChildProcess | null {
  if (windowsMuteProcess && windowsMuteProcess.exitCode === null) {
    return windowsMuteProcess
  }

  try {
    const encoded = Buffer.from(WINDOWS_MUTE_SCRIPT, 'utf16le').toString(
      'base64',
    )
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] },
    )
    child.on('error', error => {
      log.error('[systemAudio] Windows mute helper failed to start:', error)
      windowsMuteProcess = null
    })
    child.on('exit', () => {
      windowsMuteProcess = null
    })
    child.stderr?.on('data', data => {
      const text = String(data).trim()
      // PowerShell emits progress records as CLIXML on stderr — not errors
      if (text && !text.startsWith('#<') && !text.startsWith('<Objs')) {
        log.warn('[systemAudio] Windows mute helper stderr:', text)
      }
    })
    windowsMuteProcess = child
    return child
  } catch (error) {
    log.error('[systemAudio] Could not spawn Windows mute helper:', error)
    return null
  }
}

function sendWindowsMuteCommand(command: 'mute' | 'unmute'): boolean {
  const child = getWindowsMuteProcess()
  if (!child?.stdin?.writable) return false
  try {
    child.stdin.write(`${command}\n`)
    return true
  } catch (error) {
    log.error(`[systemAudio] Failed to send '${command}' command:`, error)
    return false
  }
}

/**
 * Pre-spawns the Windows mute helper so the first dictation does not pay
 * the PowerShell startup + Add-Type compilation cost. No-op elsewhere.
 */
export function warmUpSystemAudioControl(): void {
  if (os.platform() === 'win32') {
    getWindowsMuteProcess()
  }
}

/**
 * Shuts the Windows mute helper down. Closing its stdin makes the script
 * exit through its finally block, which restores the mute state — so
 * quitting mid-dictation never leaves the machine muted.
 */
export function disposeSystemAudioControl(): void {
  const child = windowsMuteProcess
  if (!child) return
  windowsMuteProcess = null
  try {
    child.stdin?.end()
  } catch {
    // Already gone — the finally block ran on its own.
  }
}

/**
 * Gets the current system volume (0-100)
 */
export function getSystemVolume(): number | null {
  if (os.platform() !== 'darwin') {
    log.warn('getSystemVolume is only supported on macOS')
    return null
  }

  try {
    const result = execSync(
      'osascript -e "get volume settings" | grep -o "output volume:[0-9]*" | grep -o "[0-9]*"',
      { encoding: 'utf8' },
    )
    return parseInt(result.trim(), 10)
  } catch (error) {
    log.error('Failed to get system volume:', error)
    return null
  }
}

/**
 * Sets the system volume (0-100)
 */
export function setSystemVolume(volume: number): boolean {
  if (os.platform() !== 'darwin') {
    log.warn('setSystemVolume is only supported on macOS')
    return false
  }

  try {
    execSync(
      `osascript -e "set volume output volume ${Math.max(0, Math.min(100, volume))}"`,
    )
    return true
  } catch (error) {
    log.error('Failed to set system volume:', error)
    return false
  }
}

/**
 * Mutes system audio and stores the previous state so it can be restored
 */
export function muteSystemAudio(): boolean {
  const platform = os.platform()

  if (platform === 'win32') {
    return sendWindowsMuteCommand('mute')
  }

  if (platform !== 'darwin') {
    log.warn('System audio control is not supported on this platform')
    return false
  }

  try {
    // Store current volume before muting
    previousVolume = getSystemVolume()
    if (previousVolume !== null) {
      console.log(`Muting system audio. Previous volume: ${previousVolume}`)
      return setSystemVolume(0)
    }
    return false
  } catch (error) {
    log.error('Failed to mute system audio:', error)
    return false
  }
}

/**
 * Unmutes system audio and restores the previous state
 */
export function unmuteSystemAudio(): boolean {
  const platform = os.platform()

  if (platform === 'win32') {
    return sendWindowsMuteCommand('unmute')
  }

  if (platform !== 'darwin') {
    log.warn('System audio control is not supported on this platform')
    return false
  }

  try {
    if (previousVolume !== null) {
      console.log(`Unmuting system audio. Restoring volume: ${previousVolume}`)
      const success = setSystemVolume(previousVolume)
      previousVolume = null // Clear stored volume
      return success
    } else {
      log.warn('No previous volume stored, cannot unmute')
      return false
    }
  } catch (error) {
    log.error('Failed to unmute system audio:', error)
    return false
  }
}
