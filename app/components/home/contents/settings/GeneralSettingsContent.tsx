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
import {
  SettingsGroup,
  SettingsRow,
  SettingsNote,
  CONTROL_WIDTH,
} from '@/app/components/ui/settings'

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
      console.error(
        '[GeneralSettingsContent] Failed to play test sound:',
        error,
      )
      setInteractionSoundStatus('Failed to trigger test playback.')
    }
  }

  const isWindows = windowContext?.window?.platform === 'win32'
  const isMac = windowContext?.window?.platform === 'darwin'

  return (
    <>
      <SettingsGroup title="Application">
        <SettingsRow
          title="Launch at login"
          description="Open Ito automatically when your computer starts."
        >
          <Switch checked={launchAtLogin} onCheckedChange={setLaunchAtLogin} />
        </SettingsRow>

        {isWindows && (
          <SettingsRow
            title="Run in background"
            description="Keep Ito running in the system tray when the window is closed."
          >
            <Switch
              checked={runInBackground}
              onCheckedChange={setRunInBackground}
            />
          </SettingsRow>
        )}

        <SettingsRow
          title="Show Ito bar at all times"
          description="Keep the floating bar visible instead of only while dictating."
        >
          <Switch
            checked={showItoBarAlways}
            onCheckedChange={setShowItoBarAlways}
          />
        </SettingsRow>

        {isMac && (
          <SettingsRow
            title="Show app in dock"
            description="Show the Ito app in the dock for quick access."
          >
            <Switch
              checked={showAppInDock}
              onCheckedChange={setShowAppInDock}
            />
          </SettingsRow>
        )}
      </SettingsGroup>

      <SettingsGroup title="Sound">
        <SettingsRow
          title="Interaction sounds"
          description="Play a sound after a voice transcription is completed."
        >
          <Switch
            checked={interactionSounds}
            onCheckedChange={setInteractionSounds}
          />
        </SettingsRow>

        <SettingsRow
          title="Sound theme"
          description="Pop, Marimba, or a custom audio file."
          align="start"
        >
          <Select
            value={interactionSoundTheme}
            onValueChange={value =>
              void handleInteractionSoundThemeChange(
                value as 'pop' | 'marimba' | 'custom',
              )
            }
          >
            <SelectTrigger id="interactionSoundTheme" className={CONTROL_WIDTH}>
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

          <div className="flex gap-1.5">
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

          {interactionSoundTheme === 'custom' && !hasCustomInteractionSound && (
            <SettingsNote>No custom sound installed yet.</SettingsNote>
          )}
          {interactionSoundStatus && (
            <SettingsNote>{interactionSoundStatus}</SettingsNote>
          )}
        </SettingsRow>
      </SettingsGroup>

      {isWindows && (
        <SettingsGroup title="Terminals">
          <SettingsRow
            title="Paste shortcut"
            description="Combo used to paste into Git Bash and Windows terminals."
          >
            <Select
              value={pasteCombo}
              onValueChange={value =>
                setPasteCombo(
                  value as 'auto' | 'ctrl-v' | 'ctrl-shift-v' | 'shift-insert',
                )
              }
            >
              <SelectTrigger id="pasteCombo" className={CONTROL_WIDTH}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto (detect)</SelectItem>
                <SelectItem value="ctrl-v">Ctrl + V (default)</SelectItem>
                <SelectItem value="ctrl-shift-v">
                  Ctrl + Shift + V (Git Bash)
                </SelectItem>
                <SelectItem value="shift-insert">
                  Shift + Insert (terminals)
                </SelectItem>
              </SelectContent>
            </Select>
          </SettingsRow>
        </SettingsGroup>
      )}

      <SettingsGroup title="Privacy">
        <SettingsRow
          title="Share analytics"
          description="Share anonymous usage data to help us improve Ito."
        >
          <Switch
            checked={shareAnalytics}
            onCheckedChange={setShareAnalytics}
          />
        </SettingsRow>
      </SettingsGroup>
    </>
  )
}
