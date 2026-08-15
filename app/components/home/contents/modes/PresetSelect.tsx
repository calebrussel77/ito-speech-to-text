import { useState } from 'react'
import { MODE_PRESETS, findPreset } from '@/lib/constants/modePresets'
import { SquareDashed } from '@mynaui/icons-react'
import { Button } from '@/app/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/app/components/ui/select'
import { SettingsNote, CONTROL_WIDTH } from '@/app/components/ui/settings'
import { modeIcon } from '@/app/components/modeIcons'

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
        <Select value={isCustom ? 'custom' : preset} onValueChange={request}>
          <SelectTrigger className={CONTROL_WIDTH}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {/* « Custom » n'existe comme option que tant que les instructions
                ont divergé : le proposer sinon laisserait croire qu'on peut
                choisir « rien », alors que c'est un constat, pas un gabarit. */}
            {isCustom && (
              <SelectItem value="custom">
                <SquareDashed className="size-3.5 text-[var(--muted-foreground)]" />
                Custom
              </SelectItem>
            )}
            {MODE_PRESETS.map(item => {
              const Icon = modeIcon(item.icon)
              return (
                <SelectItem key={item.key} value={item.key}>
                  <Icon className="size-3.5 text-[var(--muted-foreground)]" />
                  {item.label}
                </SelectItem>
              )
            })}
          </SelectContent>
        </Select>
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
