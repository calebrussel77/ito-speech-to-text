import { Switch } from '@/app/components/ui/switch'
import { useSettingsStore } from '@/app/store/useSettingsStore'
import { useWindowContext } from '@/app/components/window/WindowContext'
import { Button } from '@/app/components/ui/button'
import { useEffect, useState } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/app/components/ui/select'
import { Label } from '@/app/components/ui/label'

export default function GeneralSettingsContent() {
  const {
    shareAnalytics,
    launchAtLogin,
    interactionSounds,
    interactionSoundTheme,
    showItoBarAlways,
    showAppInDock,
    setShareAnalytics,
    setLaunchAtLogin,
    setInteractionSounds,
    setInteractionSoundTheme,
    setShowItoBarAlways,
    setShowAppInDock,
    runInBackground,
    setRunInBackground,
    pasteCombo,
    setPasteCombo,
  } = useSettingsStore()

  const windowContext = useWindowContext()
  const [hasCustomInteractionSound, setHasCustomInteractionSound] =
    useState(false)
  const [customInteractionSoundName, setCustomInteractionSoundName] = useState<
    string | null
  >(null)
  const [isSoundActionLoading, setIsSoundActionLoading] = useState(false)
  const [interactionSoundStatus, setInteractionSoundStatus] = useState('')

  useEffect(() => {
    let isMounted = true
    const loadCustomSoundState = async () => {
      try {
        const info = await window.api.interactionSound.getCustomInfo()
        if (isMounted) {
          setHasCustomInteractionSound(info.exists)
          setCustomInteractionSoundName(info.fileName)
        }
      } catch (error) {
        console.error(
          '[GeneralSettingsContent] Failed to load custom sound state:',
          error,
        )
      }
    }

    void loadCustomSoundState()

    return () => {
      isMounted = false
    }
  }, [])

  const installCustomInteractionSound = async () => {
    setIsSoundActionLoading(true)
    try {
      const selectedPath = await window.api.interactionSound.pickCustomFile()
      if (!selectedPath) {
        return false
      }

      const result =
        await window.api.interactionSound.installCustomFile(selectedPath)
      if (!result.success) {
        console.error(
          '[GeneralSettingsContent] Failed to install custom sound:',
          result.message,
        )
        setInteractionSoundStatus(
          result.message || 'Unable to install custom interaction sound.',
        )
        return false
      }

      setHasCustomInteractionSound(true)
      setCustomInteractionSoundName(result.fileName || 'Custom audio')
      setInteractionSoundStatus('Custom sound installed successfully.')
      return true
    } catch (error) {
      console.error(
        '[GeneralSettingsContent] Failed to install custom interaction sound:',
        error,
      )
      setInteractionSoundStatus('Failed to install custom interaction sound.')
      return false
    } finally {
      setIsSoundActionLoading(false)
    }
  }

  const handleInteractionSoundThemeChange = async (
    theme: 'pop' | 'marimba' | 'custom',
  ) => {
    if (theme === 'custom' && !hasCustomInteractionSound) {
      const installed = await installCustomInteractionSound()
      if (!installed) {
        return
      }
    }

    setInteractionSoundTheme(theme)
  }

  const handleUploadCustomInteractionSound = async () => {
    const installed = await installCustomInteractionSound()
    if (installed) {
      setInteractionSoundTheme('custom')
    }
  }

  const playInteractionSoundTest = async () => {
    try {
      const result = await window.api.interactionSound.playTest()
      if (!result.success) {
        setInteractionSoundStatus(
          result.message || 'Unable to play the interaction sound.',
        )
        return
      }

      const played = result.fileName || 'sound'
      setInteractionSoundStatus(`Playing "${played}"`)
    } catch (error) {
      console.error('[GeneralSettingsContent] Failed to play test sound:', error)
      setInteractionSoundStatus('Failed to trigger test playback.')
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-foreground">
                Share analytics
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Share anonymous usage data to help us improve Ito.
              </div>
            </div>
            <Switch
              checked={shareAnalytics}
              onCheckedChange={setShareAnalytics}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-foreground">
                Launch at Login
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Open Ito automatically when your computer starts.
              </div>
            </div>
            <Switch
              checked={launchAtLogin}
              onCheckedChange={setLaunchAtLogin}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-foreground">
                Interaction sounds
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Play a sound after a voice transcription is completed.
              </div>
            </div>
            <Switch
              checked={interactionSounds}
              onCheckedChange={setInteractionSounds}
            />
          </div>

          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-medium text-foreground">
                Interaction sound theme
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Choose the sound style: Pop, Marimba, or a custom audio file.
              </div>
            </div>

            <div className="w-56 space-y-2">
              <Select
                value={interactionSoundTheme}
                onValueChange={value =>
                  void handleInteractionSoundThemeChange(
                    value as 'pop' | 'marimba' | 'custom',
                  )
                }
              >
                <SelectTrigger id="interactionSoundTheme" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pop">Pop</SelectItem>
                  <SelectItem value="marimba">Marimba</SelectItem>
                  <SelectItem value="custom">
                    {customInteractionSoundName
                      ? `Custom (${customInteractionSoundName})`
                      : 'Custom'}
                  </SelectItem>
                </SelectContent>
              </Select>

              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isSoundActionLoading}
                  onClick={() => void handleUploadCustomInteractionSound()}
                >
                  Upload audio
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isSoundActionLoading}
                  onClick={() => void playInteractionSoundTest()}
                >
                  Test
                </Button>
              </div>
            </div>
          </div>

          {interactionSoundTheme === 'custom' && !hasCustomInteractionSound && (
            <div className="text-xs text-amber-600">
              No custom sound installed yet. Click Upload audio to add one.
            </div>
          )}

          {interactionSoundStatus && (
            <div className="text-xs text-muted-foreground">
              {interactionSoundStatus}
            </div>
          )}

          {windowContext?.window?.platform === 'win32' && (
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-foreground">
                  Run in background
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Keep Ito running in the system tray when the window is closed.
                </div>
              </div>
              <Switch
                checked={runInBackground}
                onCheckedChange={setRunInBackground}
              />
            </div>
          )}

          {windowContext?.window?.platform === 'win32' && (
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-medium text-foreground">
                  Paste shortcut for terminals
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Choisis le combo utilisé pour coller dans Git Bash / terminaux Windows.
                </div>
              </div>
              <div className="w-44">
                <Label className="sr-only" htmlFor="pasteCombo">
                  Paste shortcut
                </Label>
                <Select
                  value={pasteCombo}
                  onValueChange={value =>
                    setPasteCombo(
                      value as
                        | 'auto'
                        | 'ctrl-v'
                        | 'ctrl-shift-v'
                        | 'shift-insert',
                    )
                  }
                >
                  <SelectTrigger id="pasteCombo" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto (détection)</SelectItem>
                    <SelectItem value="ctrl-v">Ctrl + V (par défaut)</SelectItem>
                    <SelectItem value="ctrl-shift-v">
                      Ctrl + Shift + V (Git Bash)
                    </SelectItem>
                    <SelectItem value="shift-insert">
                      Shift + Insert (terminals)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-foreground">
                Show Ito bar at all times
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Show the Ito bar at all times.
              </div>
            </div>
            <Switch
              checked={showItoBarAlways}
              onCheckedChange={setShowItoBarAlways}
            />
          </div>

          {windowContext?.window?.platform === 'darwin' && (
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-foreground">
                  Show app in dock
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Show the Ito app in the dock for quick access.
                </div>
              </div>
              <Switch
                checked={showAppInDock}
                onCheckedChange={setShowAppInDock}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
