import { useState } from 'react'
import { MODE_PRESETS, findPreset } from '@/lib/constants/modePresets'
import { Button } from '@/app/components/ui/button'
import { SettingsNote, CONTROL_WIDTH } from '@/app/components/ui/settings'
import { cn } from '@/lib/utils'

/**
 * Le preset reste un sélecteur permanent (décision D5) : en changer réécrit
 * les instructions. Comme c'est destructif, il demande confirmation dès que
 * les instructions ont divergé du gabarit — et le libellé bascule alors sur
 * « Custom », qui dit honnêtement que le lien est rompu.
 */
export default function PresetSelect({
  preset,
  instructions,
  onApply,
}: {
  preset: string
  instructions: string
  onApply: (presetKey: string) => void
}) {
  const [pending, setPending] = useState<string | null>(null)

  const source = findPreset(preset)
  const isCustom = !source || source.instructions !== instructions

  const request = (key: string) => {
    if (key === preset && !isCustom) return
    if (instructions.trim().length > 0 && isCustom) {
      setPending(key)
      return
    }
    onApply(key)
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-5">
        <span className="text-xs font-medium text-foreground">Preset</span>
        <select
          value={isCustom ? 'custom' : preset}
          onChange={event => request(event.target.value)}
          className={cn(
            'rounded-lg border border-border bg-transparent px-2 py-1 text-xs text-foreground',
            CONTROL_WIDTH,
          )}
        >
          {isCustom && <option value="custom">Custom</option>}
          {MODE_PRESETS.map(item => (
            <option key={item.key} value={item.key}>
              {item.label}
            </option>
          ))}
        </select>
      </div>

      {pending && (
        <div className="space-y-1.5 rounded-lg border border-border p-2.5">
          <SettingsNote tone="error">
            Applying “{findPreset(pending)?.label}” replaces the instructions
            you wrote. This cannot be undone.
          </SettingsNote>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                onApply(pending)
                setPending(null)
              }}
            >
              Replace
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPending(null)}
            >
              Keep mine
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
