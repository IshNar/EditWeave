import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { dirname, resolve } from 'node:path'
import ffmpegPath from 'ffmpeg-static'

const run = promisify(execFile)
if (!ffmpegPath) throw new Error('render conformance fixture generation requires ffmpeg-static')

async function prepareFixture(filename, duration) {
  const target = resolve(`public/e2e/${filename}`)
  const temporary = resolve(`public/e2e/${filename}.${process.pid}.tmp.mp4`)
  await mkdir(dirname(target), { recursive: true })
  try {
    await run(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', `testsrc2=size=160x90:rate=30:duration=${duration}`,
      '-f', 'lavfi', '-i', `aevalsrc=exprs=0.08*sin(2*PI*997*t)+0.05*sin(2*PI*1511*t):s=48000:d=${duration}`,
      '-shortest', '-c:v', 'libx264', '-preset', 'medium', '-crf', '12', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', temporary,
    ])
    await run(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', temporary, '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', process.platform === 'win32' ? 'NUL' : '/dev/null'])
    await rm(target, { force: true })
    await rename(temporary, target)
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined)
  }
  const fixture = await stat(target)
  console.log(`Prepared desktop render conformance fixture: ${target} (${fixture.size} bytes)`)
}

async function prepareHdrFixture(filename, duration, transfer) {
  const target = resolve(`public/e2e/${filename}`)
  const temporary = resolve(`public/e2e/${filename}.${process.pid}.tmp.mp4`)
  const ffmpegTransfer = transfer === 'pq' ? 'smpte2084' : 'arib-std-b67'
  await mkdir(dirname(target), { recursive: true })
  try {
    await run(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', `testsrc2=size=160x90:rate=30:duration=${duration}`,
      '-vf', `format=gbrpf32le,zscale=primariesin=bt709:transferin=bt709:matrixin=bt709:primaries=bt2020:transfer=linear:npl=100,zscale=primaries=bt2020:transfer=${ffmpegTransfer}:matrix=bt2020nc:range=limited,format=yuv420p10le`,
      '-an', '-c:v', 'libx265', '-preset', 'medium', '-crf', '12', '-pix_fmt', 'yuv420p10le', '-tag:v', 'hvc1',
      '-color_primaries', 'bt2020', '-color_trc', ffmpegTransfer, '-colorspace', 'bt2020nc', '-color_range', 'tv', '-movflags', '+faststart', temporary,
    ])
    await run(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', temporary, '-map', '0:v:0', '-f', 'null', process.platform === 'win32' ? 'NUL' : '/dev/null'])
    await rm(target, { force: true })
    await rename(temporary, target)
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined)
  }
  const fixture = await stat(target)
  console.log(`Prepared ${transfer.toUpperCase()} Main10 conformance fixture: ${target} (${fixture.size} bytes)`)
}

await prepareFixture('render-conformance.mp4', 2)
await prepareFixture('render-conformance-long.mp4', 30)
await prepareFixture('render-conformance-10m.mp4', 600)
await prepareHdrFixture('render-conformance-hdr10-pq.mp4', 60, 'pq')
await prepareHdrFixture('render-conformance-hdr-hlg.mp4', 60, 'hlg')
