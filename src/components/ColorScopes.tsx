import { useEffect, useRef, useState } from 'react'
import type { MediaAsset } from '../editor/types'
import { scopeChroma8, scopeLuma8 } from '../media/colorConformance'

type ScopeMode = 'waveform' | 'parade' | 'vectorscope' | 'histogram'

export function ColorScopes({ asset, time, programFrame }: { asset?: MediaAsset; time: number; programFrame?: { canvas: HTMLCanvasElement; revision: number } }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [mode, setMode] = useState<ScopeMode>('waveform')
  const [status, setStatus] = useState('프레임 읽는 중')

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || (!programFrame && (!asset || asset.kind === 'audio'))) return
    let disposed = false
    let cleanup: () => void = () => undefined
    const render = (source: CanvasImageSource, sourceWidth: number, sourceHeight: number) => {
      if (disposed || !sourceWidth || !sourceHeight) return
      try {
        drawScope(canvas, source, sourceWidth, sourceHeight, mode)
        setStatus(`${Math.max(0, time).toFixed(2)}초 프레임 표본`)
      } catch {
        setStatus('이 프레임의 색상 표본을 읽을 수 없습니다.')
      }
    }

    if (programFrame) {
      render(programFrame.canvas, programFrame.canvas.width, programFrame.canvas.height)
      setStatus(`${Math.max(0, time).toFixed(2)}초 프로그램 합성 표본`)
    } else if (asset?.kind === 'image') {
      const image = new Image()
      image.onload = () => render(image, image.naturalWidth, image.naturalHeight)
      image.onerror = () => setStatus('이미지 프레임을 읽지 못했습니다.')
      image.src = asset.url
      cleanup = () => { image.onload = null; image.onerror = null }
    } else if (asset) {
      const video = document.createElement('video')
      video.muted = true
      video.preload = 'auto'
      video.playsInline = true
      const draw = () => render(video, video.videoWidth, video.videoHeight)
      const ready = () => {
        const safe = Math.max(0, Math.min(Number.isFinite(video.duration) ? Math.max(0, video.duration - 0.03) : time, time))
        if (Math.abs(video.currentTime - safe) < 0.01) draw()
        else video.currentTime = safe
      }
      video.addEventListener('loadeddata', ready)
      video.addEventListener('seeked', draw)
      video.addEventListener('error', () => setStatus('영상 프레임을 읽지 못했습니다.'))
      video.src = asset.url
      cleanup = () => {
        video.pause()
        video.removeAttribute('src')
        video.load()
      }
    }
    return () => { disposed = true; cleanup() }
  }, [asset?.id, asset?.kind, asset?.url, mode, programFrame?.revision, programFrame ? undefined : time])

  return <div className="color-scopes"><header><strong>{programFrame ? 'Program Scopes' : 'Source Scopes'}</strong><span>{status}</span></header><div className="scope-tabs">{(['waveform', 'parade', 'vectorscope', 'histogram'] as const).map((item) => <button key={item} className={mode === item ? 'active' : ''} onClick={() => setMode(item)}>{item === 'waveform' ? '파형' : item === 'parade' ? 'RGB' : item === 'vectorscope' ? '벡터' : '히스토그램'}</button>)}</div><canvas ref={canvasRef} width="300" height="120" aria-label={programFrame ? '프로그램 합성 색상 스코프' : '선택 소스 색상 스코프'} /></div>
}

function drawScope(canvas: HTMLCanvasElement, source: CanvasImageSource, sourceWidth: number, sourceHeight: number, mode: ScopeMode): void {
  const sample = document.createElement('canvas')
  sample.width = 180
  sample.height = Math.max(54, Math.round(180 * sourceHeight / sourceWidth))
  const sampleContext = sample.getContext('2d', { willReadFrequently: true })
  const context = canvas.getContext('2d')
  if (!sampleContext || !context) return
  sampleContext.drawImage(source, 0, 0, sample.width, sample.height)
  const pixels = sampleContext.getImageData(0, 0, sample.width, sample.height).data
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = '#08090d'
  context.fillRect(0, 0, canvas.width, canvas.height)

  if (mode === 'vectorscope') {
    const centerX = canvas.width / 2
    const centerY = canvas.height / 2
    const radius = Math.min(canvas.width, canvas.height) * 0.43
    context.strokeStyle = 'rgba(150,150,170,.22)'
    context.lineWidth = 1
    ;[0.25, 0.5, 0.75, 1].forEach((scale) => {
      context.beginPath()
      context.arc(centerX, centerY, radius * scale, 0, Math.PI * 2)
      context.stroke()
    })
    context.beginPath()
    context.moveTo(centerX - radius, centerY)
    context.lineTo(centerX + radius, centerY)
    context.moveTo(centerX, centerY - radius)
    context.lineTo(centerX, centerY + radius)
    context.stroke()
    const chromaPoint = (red: number, green: number, blue: number) => {
      const chroma = scopeChroma8(red, green, blue)
      return { x: centerX + chroma.cb / 127.5 * radius, y: centerY - chroma.cr / 127.5 * radius }
    }
    const targets = [
      { label: 'R', color: [255, 0, 0] }, { label: 'Y', color: [255, 255, 0] },
      { label: 'G', color: [0, 255, 0] }, { label: 'C', color: [0, 255, 255] },
      { label: 'B', color: [0, 0, 255] }, { label: 'M', color: [255, 0, 255] },
    ] as const
    context.font = '7px sans-serif'
    context.textAlign = 'center'
    targets.forEach((target) => {
      const point = chromaPoint(target.color[0], target.color[1], target.color[2])
      const x = centerX + (point.x - centerX) * 0.75
      const y = centerY + (point.y - centerY) * 0.75
      context.strokeRect(x - 4, y - 4, 8, 8)
      context.fillStyle = 'rgba(190,188,205,.72)'
      context.fillText(target.label, x, y - 6)
    })
    const skin = chromaPoint(210, 145, 115)
    context.strokeStyle = 'rgba(255,190,135,.34)'
    context.beginPath()
    context.moveTo(centerX, centerY)
    context.lineTo(centerX + (skin.x - centerX) * 2.2, centerY + (skin.y - centerY) * 2.2)
    context.stroke()
    context.globalCompositeOperation = 'lighter'
    for (let index = 0; index < pixels.length; index += 16) {
      const red = pixels[index]
      const green = pixels[index + 1]
      const blue = pixels[index + 2]
      const point = chromaPoint(red, green, blue)
      context.fillStyle = `rgba(${red},${green},${blue},.1)`
      context.fillRect(point.x, point.y, 1.4, 1.4)
    }
    context.globalCompositeOperation = 'source-over'
    return
  }

  context.strokeStyle = 'rgba(132,132,150,.16)'
  context.lineWidth = 1
  for (let y = 0; y <= 4; y++) {
    context.beginPath()
    context.moveTo(0, y * canvas.height / 4 + 0.5)
    context.lineTo(canvas.width, y * canvas.height / 4 + 0.5)
    context.stroke()
  }

  if (mode === 'histogram') {
    const bins = new Uint32Array(64)
    for (let index = 0; index < pixels.length; index += 16) {
      const luma = scopeLuma8(pixels[index], pixels[index + 1], pixels[index + 2])
      bins[Math.min(63, Math.floor(luma / 4))]++
    }
    const max = Math.max(1, ...bins)
    context.fillStyle = 'rgba(205,200,255,.72)'
    bins.forEach((count, index) => context.fillRect(index * canvas.width / bins.length, canvas.height, canvas.width / bins.length + 1, -count / max * (canvas.height - 5)))
    return
  }

  context.globalCompositeOperation = 'lighter'
  for (let y = 0; y < sample.height; y += 2) {
    for (let x = 0; x < sample.width; x += 2) {
      const index = (y * sample.width + x) * 4
      const red = pixels[index]
      const green = pixels[index + 1]
      const blue = pixels[index + 2]
      if (mode === 'waveform') {
        const luma = scopeLuma8(red, green, blue)
        context.fillStyle = 'rgba(194,255,225,.11)'
        context.fillRect(x / sample.width * canvas.width, canvas.height - luma / 255 * canvas.height, 2, 2)
      } else {
        const values = [red, green, blue]
        const colors = ['rgba(255,85,95,.13)', 'rgba(80,255,150,.13)', 'rgba(90,140,255,.14)']
        values.forEach((value, channel) => {
          const channelWidth = canvas.width / 3
          context.fillStyle = colors[channel]
          context.fillRect(channel * channelWidth + x / sample.width * channelWidth, canvas.height - value / 255 * canvas.height, 2, 2)
        })
      }
    }
  }
  context.globalCompositeOperation = 'source-over'
}
