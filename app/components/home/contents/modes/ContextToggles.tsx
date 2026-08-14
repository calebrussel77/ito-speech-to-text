import { usePlatform } from '@/app/hooks/usePlatform'
import { SettingsNote } from '@/app/components/ui/settings'
import type { ModeDto } from '@/app/index'

/**
 * Les trois contextes injectables.
 *
 * Deux honnêtetés délibérées dans les libellés : « Application » ne promet que
 * le titre de fenêtre et le nom de l'app — Ito ne sait pas lire le contenu
 * d'une fenêtre sous Windows — et « Selected text » annonce sa limite plutôt
 * que d'échouer silencieusement dans un terminal.
 */
export default function ContextToggles({
  mode,
  onChange,
}: {
  mode: ModeDto
  onChange: (patch: Record<string, unknown>) => void
}) {
  const platform = usePlatform()

  const items = [
    {
      key: 'contextApplication' as const,
      label: 'Application',
      hint: 'Window title and app name',
      value: mode.contextApplication,
    },
    {
      key: 'contextClipboard' as const,
      label: 'Copied text',
      hint: 'Whatever is in the clipboard',
      value: mode.contextClipboard,
    },
    {
      key: 'contextSelection' as const,
      label: 'Selected text',
      hint: 'The highlighted text, when the app allows reading it',
      value: mode.contextSelection,
    },
  ]

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-4">
        {items.map(item => (
          <label
            key={item.key}
            className="flex cursor-pointer items-start gap-2"
            title={item.hint}
          >
            <input
              type="checkbox"
              checked={item.value}
              onChange={event => onChange({ [item.key]: event.target.checked })}
              className="mt-0.5 size-3.5 accent-[var(--foreground)]"
            />
            <span className="text-[11px] leading-snug text-foreground">
              {item.label}
              <span className="block text-[10px] text-[var(--subtle-foreground)]">
                {item.hint}
              </span>
            </span>
          </label>
        ))}
      </div>

      {mode.contextSelection && platform === 'win32' && (
        <SettingsNote>
          On Windows, reading the selection is skipped in terminals — the
          simulated copy would interrupt whatever is running.
        </SettingsNote>
      )}
    </div>
  )
}
