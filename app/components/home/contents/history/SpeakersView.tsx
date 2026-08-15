import { useMemo, useState } from 'react'
import { Button } from '@/app/components/ui/button'
import { Input } from '@/app/components/ui/input'
import { SettingsNote } from '@/app/components/ui/settings'
import {
  formatTimestamp,
  formatSpeakerTranscript,
  uniqueSpeakers,
  type SpeakerSegment,
} from './speakersFormat'

export type { SpeakerSegment }

/**
 * Le transcript découpé par locuteur.
 *
 * Le bouton « Copy » est le maillon qui rend la diarisation utile : il place
 * le transcript **nommé** dans le presse-papier, où un mode avec le contexte
 * « Copied text » viendra le chercher pour en faire un compte-rendu par
 * participant. Sans lui, on aurait une jolie vue et aucun moyen de s'en
 * servir.
 *
 * La liste de segments est bornée en hauteur (`max-h-72 overflow-y-auto`) :
 * une réunion de plusieurs heures produit des centaines de blocs, et sans
 * cette limite la ligne d'historique engloutirait le reste de la fenêtre
 * 900×620.
 */
export default function SpeakersView({
  interactionId,
  segments,
  onRenamed,
}: {
  interactionId: string
  segments: SpeakerSegment[]
  onRenamed: () => void
}) {
  const [renaming, setRenaming] = useState(false)
  const [drafts, setDrafts] = useState<Record<number, string>>({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const [copied, setCopied] = useState(false)

  const speakers = useMemo(() => uniqueSpeakers(segments), [segments])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(formatSpeakerTranscript(segments))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      console.error('Failed to copy speaker transcript:', error)
    }
  }

  const startRenaming = () => {
    setDrafts(Object.fromEntries(speakers.map(s => [s.speaker, s.label])))
    setSaveError(false)
    setRenaming(true)
  }

  const save = async () => {
    setSaving(true)
    setSaveError(false)
    try {
      await window.api.interactions.renameSpeakers(interactionId, drafts)
      setRenaming(false)
      onRenamed()
    } catch (error) {
      console.error('Failed to rename speakers:', error)
      // Le panneau reste ouvert avec ce que l'utilisateur a saisi : le
      // refermer sur un échec ferait croire, à tort, que le renommage a pris.
      setSaveError(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => (renaming ? setRenaming(false) : startRenaming())}
        >
          {renaming ? 'Cancel' : 'Rename speakers'}
        </Button>
        {copied && (
          <SettingsNote>
            Now dictate in a mode with “Copied text” switched on to summarize
            it.
          </SettingsNote>
        )}
      </div>

      {renaming && (
        <div className="space-y-1.5 rounded-lg border border-border p-2.5">
          {speakers.map(speaker => (
            <div key={speaker.speaker} className="flex items-center gap-2">
              <span className="w-20 shrink-0 truncate text-[11px] text-[var(--subtle-foreground)]">
                {speaker.label}
              </span>
              <Input
                className="h-7 text-xs"
                value={drafts[speaker.speaker] ?? ''}
                placeholder="Name"
                disabled={saving}
                onChange={event =>
                  setDrafts(previous => ({
                    ...previous,
                    [speaker.speaker]: event.target.value,
                  }))
                }
              />
            </div>
          ))}
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
            {saveError && (
              <SettingsNote tone="error">
                Couldn&rsquo;t save. Try again.
              </SettingsNote>
            )}
          </div>
        </div>
      )}

      <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
        {segments.map((segment, index) => (
          <div
            key={`${segment.speaker}-${segment.startMs}-${index}`}
            className="flex gap-2"
          >
            <span className="w-24 shrink-0 text-[10px] tabular-nums text-[var(--subtle-foreground)]">
              {formatTimestamp(segment.startMs)}–
              {formatTimestamp(segment.endMs)}
            </span>
            <span className="min-w-0">
              <span className="mr-1.5 text-[11px] font-medium text-foreground">
                {segment.label}
              </span>
              <span className="text-[11px] leading-snug text-[var(--muted-foreground)]">
                {segment.text}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
