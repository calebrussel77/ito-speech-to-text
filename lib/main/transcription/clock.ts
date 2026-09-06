/**
 * `MM:SS` ou `HH:MM:SS` en millisecondes. Rend 0 sur une valeur illisible
 * plutôt que `NaN` : un horodatage faux décale un segment, un `NaN` casse tout
 * l'affichage de l'historique.
 */
export function parseClock(value: string): number {
  const parts = String(value ?? '')
    .trim()
    .split(':')
    .map(part => Number(part))
  if (parts.some(part => !Number.isFinite(part))) return 0
  const [hours, minutes, seconds] =
    parts.length === 3 ? parts : [0, parts[0] ?? 0, parts[1] ?? 0]
  return Math.max(0, (hours * 3600 + minutes * 60 + seconds) * 1000)
}
