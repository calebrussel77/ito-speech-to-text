import { useState } from 'react'
import { Input } from '@/app/components/ui/input'
import { Button } from '@/app/components/ui/button'
import { SettingsNote } from '@/app/components/ui/settings'
import { PROVIDER_ICONS } from '@/app/components/icons/modelLabIcons'
import { cn } from '@/lib/utils'

type Status = 'idle' | 'testing' | 'ok' | 'error'
type ApiTestResult = { ok: boolean; message?: string }

/** A failure the transcription pipeline recorded against the stored key. */
export type KeyRejection = { message: string; at: string }

const formatWhen = (iso: string) => {
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? 'recently'
    : date.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
}

type ProviderKeyRowProps = {
  provider: 'groq' | 'openrouter' | 'deepgram'
  name: string
  hint: string
  placeholder: string
  consoleUrl: string
  storedKey: string
  /**
   * Set when dictations are failing on this key. The row is the one place a
   * user looks after a dictation was downgraded, so the reason belongs here
   * and not only in the notification that has since disappeared.
   */
  rejection?: KeyRejection | null
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
  rejection,
  expanded,
  onToggle,
  onSave,
  onTest,
}: ProviderKeyRowProps) {
  const [localKey, setLocalKey] = useState(storedKey || '')
  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState('')
  // The record is pinned to the key that earned it, so any edit here makes it
  // obsolete before the main process is asked again.
  const [rejectionCleared, setRejectionCleared] = useState(false)

  const Icon = PROVIDER_ICONS[provider]
  const configured = !!storedKey
  const liveRejection = rejectionCleared ? null : rejection

  const handleSave = () => {
    onSave(localKey.trim())
    setStatus('idle')
    setMessage('Saved locally')
    setRejectionCleared(true)
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
      if (result.ok) setRejectionCleared(true)
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
            {liveRejection
              ? liveRejection.message
              : configured
                ? hint
                : 'No key — its models are unavailable'}
          </span>
        </span>
        <span
          className={cn(
            'flex shrink-0 items-center gap-1.5 rounded-full px-2 py-px text-[10px] uppercase tracking-wide',
            configured && !liveRejection
              ? 'bg-foreground/10 text-foreground'
              : 'border border-border-strong text-[var(--subtle-foreground)]',
          )}
        >
          {liveRejection && (
            <span className="size-1.5 rounded-full bg-destructive" />
          )}
          {liveRejection ? 'Rejected' : configured ? 'Configured' : 'Missing'}
        </span>
        <Button variant="outline" size="sm" onClick={onToggle}>
          {expanded ? 'Close' : configured ? 'Edit' : 'Add key'}
        </Button>
      </div>

      {liveRejection && !expanded && (
        <div className="pl-7">
          <SettingsNote tone="error">
            {`Last refused ${formatWhen(liveRejection.at)} — long dictations are staying on Groq.`}
          </SettingsNote>
        </div>
      )}

      {expanded && (
        <div className="mt-1.5 space-y-2 pl-7">
          {liveRejection && (
            <SettingsNote tone="error">
              {`${liveRejection.message} (last refused ${formatWhen(liveRejection.at)})`}
            </SettingsNote>
          )}
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
