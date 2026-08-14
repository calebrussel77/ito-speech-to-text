import { useState } from 'react'
import { Input } from '@/app/components/ui/input'
import { Button } from '@/app/components/ui/button'
import { SettingsNote } from '@/app/components/ui/settings'
import { PROVIDER_ICONS } from '@/app/components/icons/modelLabIcons'
import { cn } from '@/lib/utils'

type Status = 'idle' | 'testing' | 'ok' | 'error'
type ApiTestResult = { ok: boolean; message?: string }

type ProviderKeyRowProps = {
  provider: 'groq' | 'openrouter'
  name: string
  hint: string
  placeholder: string
  consoleUrl: string
  storedKey: string
  /** Opened by the "Add a key" links under the model tables. */
  expanded: boolean
  onToggle: () => void
  onSave: (key: string) => void
  onTest: (key: string) => Promise<ApiTestResult>
}

/**
 * A key is entered once and then forgotten, so the full form only appears on
 * demand: collapsed, a provider costs one line instead of the ~120px card it
 * used to, which is what lets the model tables sit above the fold in a 620px
 * window.
 */
export default function ProviderKeyRow({
  provider,
  name,
  hint,
  placeholder,
  consoleUrl,
  storedKey,
  expanded,
  onToggle,
  onSave,
  onTest,
}: ProviderKeyRowProps) {
  const [localKey, setLocalKey] = useState(storedKey || '')
  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState('')

  const Icon = PROVIDER_ICONS[provider]
  const configured = !!storedKey

  const handleSave = () => {
    onSave(localKey.trim())
    setStatus('idle')
    setMessage('Saved locally')
  }

  const handleClear = () => {
    setLocalKey('')
    onSave('')
    setStatus('idle')
    setMessage('Cleared')
  }

  const handleTest = async () => {
    if (!localKey.trim()) {
      setStatus('error')
      setMessage('Enter an API key first')
      return
    }
    setStatus('testing')
    setMessage('Testing connection…')
    try {
      const result = await onTest(localKey.trim())
      setStatus(result.ok ? 'ok' : 'error')
      setMessage(result.message || (result.ok ? 'Connected' : 'Failed'))
    } catch (error: any) {
      setStatus('error')
      setMessage(error?.message || 'Unable to test key')
    }
  }

  return (
    <div className="py-1">
      <div className="flex items-center gap-3 py-1.5">
        <span className="size-4 shrink-0 overflow-hidden rounded-[3px]">
          <Icon />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-medium text-foreground">
            {name}
          </span>
          <span className="block truncate text-[11px] leading-snug text-[var(--subtle-foreground)]">
            {configured ? hint : 'No key — its models are unavailable'}
          </span>
        </span>
        <span
          className={cn(
            'shrink-0 rounded-full px-2 py-px text-[10px] uppercase tracking-wide',
            configured
              ? 'bg-foreground/10 text-foreground'
              : 'border border-border-strong text-[var(--subtle-foreground)]',
          )}
        >
          {configured ? 'Configured' : 'Missing'}
        </span>
        <Button variant="outline" size="sm" onClick={onToggle}>
          {expanded ? 'Close' : configured ? 'Edit' : 'Add key'}
        </Button>
      </div>

      {expanded && (
        <div className="mt-1.5 space-y-2 pl-7">
          <Input
            type="password"
            value={localKey}
            placeholder={placeholder}
            onChange={e => setLocalKey(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={handleSave}>
              Save
            </Button>
            <Button variant="outline" size="sm" onClick={handleClear}>
              Clear
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleTest}
              disabled={status === 'testing'}
            >
              {status === 'testing' ? 'Testing…' : 'Test connection'}
            </Button>
            <Button
              variant="link"
              size="sm"
              className="text-xs"
              onClick={e => {
                e.preventDefault()
                window.api['web-open-url'](consoleUrl)
              }}
            >
              Get a key
            </Button>
          </div>
          {message && (
            <SettingsNote tone={status === 'error' ? 'error' : 'muted'}>
              {message}
            </SettingsNote>
          )}
          <SettingsNote>Stored locally, encrypted at rest.</SettingsNote>
        </div>
      )}
    </div>
  )
}
