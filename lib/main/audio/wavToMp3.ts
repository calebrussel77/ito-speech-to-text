import { StreamingMp3Encoder } from './streamingEncoder'

export type WavInfo = {
  sampleRate: number
  channels: number
  bitDepth: number
  dataOffset: number
  dataLength: number
}

/**
 * Lit l'en-tête d'un WAV PCM quelconque (pas seulement ceux qu'Ito écrit) :
 * parcourt les chunks jusqu'à `fmt ` puis `data`. Rend null si ce n'est pas
 * du PCM 16 bits, le seul format que l'encodeur sait prendre.
 */
export function readWavInfo(wav: Buffer): WavInfo | null {
  if (wav.length < 12) return null
  if (wav.toString('ascii', 0, 4) !== 'RIFF') return null
  if (wav.toString('ascii', 8, 12) !== 'WAVE') return null

  let offset = 12
  let format: {
    sampleRate: number
    channels: number
    bitDepth: number
  } | null = null
  while (offset + 8 <= wav.length) {
    const id = wav.toString('ascii', offset, offset + 4)
    const size = wav.readUInt32LE(offset + 4)
    const body = offset + 8
    if (id === 'fmt ' && body + 16 <= wav.length) {
      const audioFormat = wav.readUInt16LE(body)
      const channels = wav.readUInt16LE(body + 2)
      const sampleRate = wav.readUInt32LE(body + 4)
      const bitDepth = wav.readUInt16LE(body + 14)
      // 1 = PCM ; 0xFFFE = WAVE_FORMAT_EXTENSIBLE, PCM dans les faits pour
      // les fichiers 16 bits produits par les enregistreurs courants.
      if (audioFormat !== 1 && audioFormat !== 0xfffe) return null
      format = { sampleRate, channels, bitDepth }
    } else if (id === 'data') {
      if (!format || format.bitDepth !== 16 || format.channels < 1) return null
      const dataLength = Math.min(size, wav.length - body)
      return { ...format, dataOffset: body, dataLength }
    }
    offset = body + size + (size % 2)
  }
  return null
}

/**
 * Le PCM d'un WAV, ramené en mono 16 bits par blocs : un fichier stéréo est
 * moyenné canal par canal, un fichier mono est recopié tel quel.
 */
export function* monoPcmChunks(
  wav: Buffer,
  info: WavInfo,
  samplesPerChunk = 16_000,
): Generator<Buffer> {
  const frameBytes = info.channels * 2
  const frames = Math.floor(info.dataLength / frameBytes)
  for (let start = 0; start < frames; start += samplesPerChunk) {
    const count = Math.min(samplesPerChunk, frames - start)
    const out = Buffer.alloc(count * 2)
    for (let i = 0; i < count; i++) {
      const frameOffset = info.dataOffset + (start + i) * frameBytes
      let sum = 0
      for (let c = 0; c < info.channels; c++) {
        sum += wav.readInt16LE(frameOffset + c * 2)
      }
      out.writeInt16LE(Math.round(sum / info.channels), i * 2)
    }
    yield out
  }
}

/**
 * Un WAV importé (OBS, un dictaphone) pèse 10 Mo la minute en 44,1 kHz
 * stéréo ; le même contenu en MP3 mono 48 kbit/s en pèse 0,36. Encodé ici,
 * dans le worker, avant l'envoi. Rend null quand le fichier n'est pas du
 * PCM 16 bits ou que l'encodage échoue : l'appelant envoie alors l'original.
 */
export async function wavToMp3(wav: Buffer): Promise<Buffer | null> {
  const info = readWavInfo(wav)
  if (!info) return null
  const encoder = new StreamingMp3Encoder()
  try {
    encoder.start(info.sampleRate)
    for (const chunk of monoPcmChunks(wav, info)) encoder.push(chunk)
    // Tout le fichier reste à encoder à cet instant : ~2 s par minute
    // d'audio, borné à dix minutes avant de renoncer.
    const mp3 = await encoder.finish(10 * 60 * 1000)
    return mp3 && mp3.length > 0 ? mp3 : null
  } catch (error) {
    console.warn('[wavToMp3] Encoding failed, sending the WAV as is:', error)
    encoder.abort()
    return null
  }
}
