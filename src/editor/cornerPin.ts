import type { VisualEffects } from './types'

export type CornerPinPoint = { x: number; y: number }

export const defaultCornerPinPoints = (): [CornerPinPoint, CornerPinPoint, CornerPinPoint, CornerPinPoint] => [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
]

function affineTriangle(
  source: [CornerPinPoint, CornerPinPoint, CornerPinPoint],
  target: [CornerPinPoint, CornerPinPoint, CornerPinPoint],
): [number, number, number, number, number, number] | undefined {
  const [s0, s1, s2] = source
  const [t0, t1, t2] = target
  const determinant = s0.x * (s1.y - s2.y) + s1.x * (s2.y - s0.y) + s2.x * (s0.y - s1.y)
  if (Math.abs(determinant) < 0.000001) return undefined
  const coefficient = (v0: number, v1: number, v2: number) => ({
    x: (v0 * (s1.y - s2.y) + v1 * (s2.y - s0.y) + v2 * (s0.y - s1.y)) / determinant,
    y: (v0 * (s2.x - s1.x) + v1 * (s0.x - s2.x) + v2 * (s1.x - s0.x)) / determinant,
    offset: (v0 * (s1.x * s2.y - s2.x * s1.y) + v1 * (s2.x * s0.y - s0.x * s2.y) + v2 * (s0.x * s1.y - s1.x * s0.y)) / determinant,
  })
  const x = coefficient(t0.x, t1.x, t2.x)
  const y = coefficient(t0.y, t1.y, t2.y)
  return [x.x, y.x, x.y, y.y, x.offset, y.offset]
}

function interpolateQuad(points: readonly CornerPinPoint[], u: number, v: number): CornerPinPoint {
  const [topLeft, topRight, bottomRight, bottomLeft] = points
  const topX = topLeft.x + (topRight.x - topLeft.x) * u
  const topY = topLeft.y + (topRight.y - topLeft.y) * u
  const bottomX = bottomLeft.x + (bottomRight.x - bottomLeft.x) * u
  const bottomY = bottomLeft.y + (bottomRight.y - bottomLeft.y) * u
  return { x: topX + (bottomX - topX) * v, y: topY + (bottomY - topY) * v }
}

export function applyCornerPin(
  context: CanvasRenderingContext2D,
  bounds: { x: number; y: number; width: number; height: number },
  effects: Pick<VisualEffects, 'cornerPinEnabled' | 'cornerPinPoints'>,
  subdivisions = 12,
): void {
  if (!effects.cornerPinEnabled) return
  const points = effects.cornerPinPoints?.length === 4 ? effects.cornerPinPoints : defaultCornerPinPoints()
  const snapshot = document.createElement('canvas')
  snapshot.width = context.canvas.width
  snapshot.height = context.canvas.height
  snapshot.getContext('2d')?.drawImage(context.canvas, 0, 0)
  context.clearRect(0, 0, context.canvas.width, context.canvas.height)
  const target = points.map((point) => ({ x: bounds.x + bounds.width * point.x / 100, y: bounds.y + bounds.height * point.y / 100 }))
  const count = Math.max(2, Math.min(32, Math.round(subdivisions)))
  const sourceAt = (u: number, v: number) => ({ x: bounds.x + bounds.width * u, y: bounds.y + bounds.height * v })
  const targetAt = (u: number, v: number) => interpolateQuad(target, u, v)
  const drawTriangle = (source: [CornerPinPoint, CornerPinPoint, CornerPinPoint], destination: [CornerPinPoint, CornerPinPoint, CornerPinPoint]) => {
    const matrix = affineTriangle(source, destination)
    if (!matrix) return
    context.save()
    context.beginPath()
    context.moveTo(destination[0].x, destination[0].y)
    context.lineTo(destination[1].x, destination[1].y)
    context.lineTo(destination[2].x, destination[2].y)
    context.closePath()
    context.clip()
    context.transform(...matrix)
    context.drawImage(snapshot, 0, 0)
    context.restore()
  }
  for (let row = 0; row < count; row += 1) {
    for (let column = 0; column < count; column += 1) {
      const u0 = column / count
      const u1 = (column + 1) / count
      const v0 = row / count
      const v1 = (row + 1) / count
      const s00 = sourceAt(u0, v0)
      const s10 = sourceAt(u1, v0)
      const s11 = sourceAt(u1, v1)
      const s01 = sourceAt(u0, v1)
      const d00 = targetAt(u0, v0)
      const d10 = targetAt(u1, v0)
      const d11 = targetAt(u1, v1)
      const d01 = targetAt(u0, v1)
      drawTriangle([s00, s10, s11], [d00, d10, d11])
      drawTriangle([s00, s11, s01], [d00, d11, d01])
    }
  }
}
