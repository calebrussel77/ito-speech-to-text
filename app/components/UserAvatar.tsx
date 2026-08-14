import { useMemo } from 'react'
import { Avatar, Style } from '@dicebear/core'
// Vendored rather than pulled from @dicebear/styles: that package ships every
// style at 6.9 MB and we need one 13 KB definition from it. It is also the
// only file the project's node10 module resolution could not reach, since the
// package publishes it through an `exports` map. CC0, so copying is intended.
import definition from '@/app/assets/dicebear-blobs.json'

// One Style instance for the whole app: parsing the definition is the
// expensive half, and it never varies.
const blobs = new Style(definition as never)

/**
 * Identicon for the signed-in user, in DiceBear's "blobs" style, derived from
 * their name.
 *
 * Generated locally rather than fetched from api.dicebear.com. The HTTP route
 * is one line shorter but would send the user's name to a third party on every
 * launch, which an app that promises its keys "never leave this device" has no
 * business doing. The definition is 13 KB of JSON and the same seed always
 * yields the same avatar, so nothing is lost.
 */
export default function UserAvatar({
  name,
  size = 16,
  className,
}: {
  name?: string | null
  size?: number
  className?: string
}) {
  // Falls back to a fixed seed so the shape stays stable rather than jumping
  // around while a name loads or when there is none.
  const seed = name?.trim() || 'ito'

  const svg = useMemo(
    () => new Avatar(blobs, { seed, size }).toString(),
    [seed, size],
  )

  return (
    <span
      className={className}
      style={{ width: size, height: size, display: 'inline-block' }}
      // The seed only feeds the shape hash — DiceBear never writes it into the
      // markup — so there is nothing user-controlled in this string.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
