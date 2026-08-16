interface MotionInterpolationBuffers {
  lowerAnalysis: HTMLCanvasElement
  upperAnalysis: HTMLCanvasElement
  lowerWarp: HTMLCanvasElement
  upperWarp: HTMLCanvasElement
}

const interpolationBuffers = new WeakMap<HTMLCanvasElement, MotionInterpolationBuffers>()

function createCanvas(width = 1, height = 1): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

function resizeCanvas(canvas: HTMLCanvasElement, width: number, height: number) {
  if (canvas.width !== width) canvas.width = width
  if (canvas.height !== height) canvas.height = height
}

function buffersFor(target: HTMLCanvasElement): MotionInterpolationBuffers {
  let buffers = interpolationBuffers.get(target)
  if (!buffers) {
    buffers = {
      lowerAnalysis: createCanvas(),
      upperAnalysis: createCanvas(),
      lowerWarp: createCanvas(),
      upperWarp: createCanvas(),
    }
    interpolationBuffers.set(target, buffers)
  }
  return buffers
}

function drawBlend(
  context: CanvasRenderingContext2D,
  lower: CanvasImageSource,
  upper: CanvasImageSource,
  width: number,
  height: number,
  fraction: number,
) {
  context.save()
  context.setTransform(1, 0, 0, 1, 0, 0)
  context.globalCompositeOperation = 'copy'
  context.globalAlpha = 1
  context.drawImage(lower, 0, 0, width, height)
  context.globalCompositeOperation = 'source-over'
  context.globalAlpha = fraction
  context.drawImage(upper, 0, 0, width, height)
  context.restore()
}

function luma(data: Uint8ClampedArray, pixel: number): number {
  const offset = pixel * 4
  return data[offset] * 0.2126 + data[offset + 1] * 0.7152 + data[offset + 2] * 0.0722
}

function blockDifference(
  lower: Uint8ClampedArray,
  upper: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  blockWidth: number,
  blockHeight: number,
  offsetX: number,
  offsetY: number,
): number {
  let difference = 0
  let samples = 0
  for (let localY = 1; localY < blockHeight; localY += 2) {
    const lowerY = y + localY
    const upperY = lowerY + offsetY
    if (lowerY < 0 || lowerY >= height || upperY < 0 || upperY >= height) continue
    for (let localX = 1; localX < blockWidth; localX += 2) {
      const lowerX = x + localX
      const upperX = lowerX + offsetX
      if (lowerX < 0 || lowerX >= width || upperX < 0 || upperX >= width) continue
      difference += Math.abs(luma(lower, lowerY * width + lowerX) - luma(upper, upperY * width + upperX))
      samples += 1
    }
  }
  return samples ? difference / samples : Number.POSITIVE_INFINITY
}

/**
 * Produces an in-between frame with local block-motion compensation. The
 * analysis is intentionally resolution-limited while the two source frames are
 * warped at their original dimensions, keeping interactive preview responsive
 * without lowering final output resolution.
 */
export function drawMotionCompensatedFrame(
  target: HTMLCanvasElement,
  lower: CanvasImageSource,
  upper: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  fraction: number,
): HTMLCanvasElement {
  const width = Math.max(1, Math.round(sourceWidth))
  const height = Math.max(1, Math.round(sourceHeight))
  const mix = Math.max(0, Math.min(1, fraction))
  resizeCanvas(target, width, height)
  const targetContext = target.getContext('2d', { alpha: true })
  if (!targetContext) return target
  if (mix <= 0.0001 || mix >= 0.9999) {
    targetContext.save()
    targetContext.setTransform(1, 0, 0, 1, 0, 0)
    targetContext.globalCompositeOperation = 'copy'
    targetContext.globalAlpha = 1
    targetContext.drawImage(mix < 0.5 ? lower : upper, 0, 0, width, height)
    targetContext.restore()
    return target
  }

  const buffers = buffersFor(target)
  const analysisScale = Math.min(1, 320 / Math.max(width, height))
  const analysisWidth = Math.max(16, Math.round(width * analysisScale))
  const analysisHeight = Math.max(16, Math.round(height * analysisScale))
  resizeCanvas(buffers.lowerAnalysis, analysisWidth, analysisHeight)
  resizeCanvas(buffers.upperAnalysis, analysisWidth, analysisHeight)
  resizeCanvas(buffers.lowerWarp, width, height)
  resizeCanvas(buffers.upperWarp, width, height)
  const lowerAnalysisContext = buffers.lowerAnalysis.getContext('2d', { willReadFrequently: true })
  const upperAnalysisContext = buffers.upperAnalysis.getContext('2d', { willReadFrequently: true })
  const lowerWarpContext = buffers.lowerWarp.getContext('2d', { alpha: true })
  const upperWarpContext = buffers.upperWarp.getContext('2d', { alpha: true })
  if (!lowerAnalysisContext || !upperAnalysisContext || !lowerWarpContext || !upperWarpContext) {
    drawBlend(targetContext, lower, upper, width, height, mix)
    return target
  }

  try {
    lowerAnalysisContext.drawImage(lower, 0, 0, analysisWidth, analysisHeight)
    upperAnalysisContext.drawImage(upper, 0, 0, analysisWidth, analysisHeight)
    const lowerPixels = lowerAnalysisContext.getImageData(0, 0, analysisWidth, analysisHeight).data
    const upperPixels = upperAnalysisContext.getImageData(0, 0, analysisWidth, analysisHeight).data
    lowerWarpContext.globalCompositeOperation = 'copy'
    lowerWarpContext.globalAlpha = 1
    lowerWarpContext.drawImage(lower, 0, 0, width, height)
    upperWarpContext.globalCompositeOperation = 'copy'
    upperWarpContext.globalAlpha = 1
    upperWarpContext.drawImage(upper, 0, 0, width, height)
    lowerWarpContext.globalCompositeOperation = 'source-over'
    upperWarpContext.globalCompositeOperation = 'source-over'

    const blockSize = 8
    const searchRadius = 8
    const scaleX = width / analysisWidth
    const scaleY = height / analysisHeight
    for (let y = 0; y < analysisHeight; y += blockSize) {
      for (let x = 0; x < analysisWidth; x += blockSize) {
        const blockWidth = Math.min(blockSize, analysisWidth - x)
        const blockHeight = Math.min(blockSize, analysisHeight - y)
        const unchangedDifference = blockDifference(lowerPixels, upperPixels, analysisWidth, analysisHeight, x, y, blockWidth, blockHeight, 0, 0)
        let bestDifference = unchangedDifference
        let bestX = 0
        let bestY = 0
        for (let offsetY = -searchRadius; offsetY <= searchRadius; offsetY += 2) {
          for (let offsetX = -searchRadius; offsetX <= searchRadius; offsetX += 2) {
            if (!offsetX && !offsetY) continue
            const difference = blockDifference(lowerPixels, upperPixels, analysisWidth, analysisHeight, x, y, blockWidth, blockHeight, offsetX, offsetY)
            if (difference < bestDifference) {
              bestDifference = difference
              bestX = offsetX
              bestY = offsetY
            }
          }
        }
        // Flat/noisy regions do not contain a reliable motion signal. Keeping
        // those blocks stationary prevents arbitrary vectors from shimmering.
        if (!Number.isFinite(bestDifference) || bestDifference > unchangedDifference * 0.94) {
          bestX = 0
          bestY = 0
        }
        if (!bestX && !bestY) continue
        const sourceX = x * scaleX
        const sourceY = y * scaleY
        const sourceBlockWidth = Math.min(width - sourceX, blockWidth * scaleX)
        const sourceBlockHeight = Math.min(height - sourceY, blockHeight * scaleY)
        const motionX = bestX * scaleX
        const motionY = bestY * scaleY
        const overlap = Math.max(1, Math.min(scaleX, scaleY))
        lowerWarpContext.drawImage(lower, sourceX, sourceY, sourceBlockWidth, sourceBlockHeight, sourceX + motionX * mix - overlap, sourceY + motionY * mix - overlap, sourceBlockWidth + overlap * 2, sourceBlockHeight + overlap * 2)
        const upperSourceX = Math.max(0, Math.min(width - sourceBlockWidth, sourceX + motionX))
        const upperSourceY = Math.max(0, Math.min(height - sourceBlockHeight, sourceY + motionY))
        upperWarpContext.drawImage(upper, upperSourceX, upperSourceY, sourceBlockWidth, sourceBlockHeight, sourceX - motionX * (1 - mix) - overlap, sourceY - motionY * (1 - mix) - overlap, sourceBlockWidth + overlap * 2, sourceBlockHeight + overlap * 2)
      }
    }
    drawBlend(targetContext, buffers.lowerWarp, buffers.upperWarp, width, height, mix)
  } catch {
    drawBlend(targetContext, lower, upper, width, height, mix)
  }
  return target
}
