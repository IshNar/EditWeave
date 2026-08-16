export interface ChromaKeySettings {
  enabled?: boolean
  color?: string
  tolerance?: number
  softness?: number
  spill?: number
}

export function applyChromaKey(context: CanvasRenderingContext2D, width: number, height: number, settings: ChromaKeySettings): void {
  if (!settings.enabled || width < 1 || height < 1) return
  const [keyRed, keyGreen, keyBlue] = parseHex(settings.color ?? '#00ff00')
  const tolerance = Math.max(0, Math.min(100, settings.tolerance ?? 32)) * 2.2
  const softness = Math.max(1, Math.min(100, settings.softness ?? 18)) * 1.4
  const spill = Math.max(0, Math.min(100, settings.spill ?? 45)) / 100
  const image = context.getImageData(0, 0, width, height)
  for (let index = 0; index < image.data.length; index += 4) {
    const red = image.data[index]
    const green = image.data[index + 1]
    const blue = image.data[index + 2]
    const distance = Math.hypot(red - keyRed, green - keyGreen, blue - keyBlue)
    const alpha = Math.max(0, Math.min(1, (distance - tolerance) / softness))
    image.data[index + 3] = Math.round(image.data[index + 3] * alpha)
    if (keyGreen > keyRed && keyGreen > keyBlue && alpha < 1) {
      const neutral = (red + blue) / 2
      image.data[index + 1] = Math.round(green + (neutral - green) * spill * (1 - alpha))
    }
  }
  context.putImageData(image, 0, 0)
}

function parseHex(value: string): [number, number, number] {
  const normalized = value.replace('#', '')
  if (/^[0-9a-f]{3}$/i.test(normalized)) return [0, 1, 2].map((index) => parseInt(normalized[index] + normalized[index], 16)) as [number, number, number]
  if (/^[0-9a-f]{6}$/i.test(normalized)) return [parseInt(normalized.slice(0, 2), 16), parseInt(normalized.slice(2, 4), 16), parseInt(normalized.slice(4, 6), 16)]
  return [0, 255, 0]
}
