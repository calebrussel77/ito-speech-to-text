import { Switch } from '@/app/components/ui/switch'
import { useSettingsStore } from '@/app/store/useSettingsStore'
import { useWindowContext } from '@/app/components/window/WindowContext'
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
    showItoBarAlways,
    showAppInDock,
    setShareAnalytics,
    setLaunchAtLogin,
    setShowItoBarAlways,
    setShowAppInDock,
    runInBackground,
    setRunInBackground,
    pasteCombo,
    setPasteCombo,
  } = useSettingsStore()

  const windowContext = useWindowContext()

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
