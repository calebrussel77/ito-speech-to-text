import { Switch } from '@/app/components/ui/switch'
import { MicrophoneSelector } from '@/app/components/ui/microphone-selector'
import { SettingsGroup, SettingsRow } from '@/app/components/ui/settings'
import { useSettingsStore } from '@/app/store/useSettingsStore'

export default function AudioSettingsContent() {
  const {
    microphoneDeviceId,
    microphoneName,
    muteAudioWhenDictating,
    setMicrophoneDeviceId,
    setMuteAudioWhenDictating,
  } = useSettingsStore()

  return (
    <SettingsGroup>
      <SettingsRow
        title="Mute audio when dictating"
        description="Silence every other sound on your machine (music, videos, notifications) while you record, and restore it right after."
      >
        <Switch
          checked={muteAudioWhenDictating}
          onCheckedChange={setMuteAudioWhenDictating}
        />
      </SettingsRow>

      <SettingsRow
        title="Default microphone"
        description="The microphone Ito uses for audio input."
      >
        <MicrophoneSelector
          selectedDeviceId={microphoneDeviceId}
          selectedMicrophoneName={microphoneName}
          onSelectionChange={setMicrophoneDeviceId}
          triggerButtonVariant="outline"
          triggerButtonClassName=""
        />
      </SettingsRow>
    </SettingsGroup>
  )
}
