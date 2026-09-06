import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/app/components/ui/tooltip'

type Latency = Partial<
  Record<
    | 'prepareMs'
    | 'encodeMs'
    | 'contextMs'
    | 'asrMs'
    | 'adjustMs'
    | 'pasteMs'
    | 'totalMs'
    | 'uploadBytes',
    number
  >
>

const STAGES: Array<[keyof Latency, string]> = [
  ['prepareMs', 'Audio'],
  ['encodeMs', 'Encodage'],
  ['contextMs', 'Contexte'],
  ['asrMs', 'Transcription'],
  ['adjustMs', 'Réécriture'],
  ['pasteMs', 'Collage'],
]

const formatSeconds = (ms: number) =>
  ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`

/**
 * Le temps entre le relâchement du raccourci et le texte collé, avec le
 * détail par étape au survol. C'est la seule mesure de latence qui existe
 * sans télémétrie : elle est ce qui permet de comparer deux modèles ou deux
 * réglages autrement qu'à l'impression.
 */
export default function LatencyBadge({
  latency,
  drainTruncated,
}: {
  latency?: Latency | null
  drainTruncated?: boolean | null
}) {
  if (!latency || typeof latency.totalMs !== 'number') return null

  return (
    <Tooltip>
      <TooltipTrigger className="text-[11px] leading-4 tabular-nums text-[var(--subtle-foreground)]">
        {formatSeconds(latency.totalMs)}
        {drainTruncated ? ' ⚠' : ''}
      </TooltipTrigger>
      <TooltipContent>
        <div className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 tabular-nums">
          {STAGES.map(([key, label]) => {
            const value = latency[key]
            if (typeof value !== 'number') return null
            return (
              <div key={key} className="contents">
                <span>{label}</span>
                <span className="text-right">{formatSeconds(value)}</span>
              </div>
            )
          })}
        </div>
        {typeof latency.uploadBytes === 'number' && (
          <div className="mt-1 text-[var(--subtle-foreground)]">
            Envoyé : {(latency.uploadBytes / 1024).toFixed(0)} Ko
          </div>
        )}
        {drainTruncated && (
          <div className="mt-1">
            Le micro n'a pas confirmé la vidange : la fin est peut-être
            tronquée.
          </div>
        )}
      </TooltipContent>
    </Tooltip>
  )
}
