import type { ClipTransform } from '../editor/types'
import type { HdrFrameData } from './hdr10'

type HdrTransfer = 'pq' | 'hlg'

export interface RawHdrFrame {
  data: Uint8Array
  layout: PlaneLayout[]
  codedWidth: number
  codedHeight: number
  visibleRect: { x: number; y: number; width: number; height: number }
  displayWidth: number
  displayHeight: number
}

interface Resources {
  device: any
  pipeline: any
  output: any
  readback: any
  parameters: any
  input?: any
  inputCapacity: number
  outputByteLength: number
  mapMode: any
  usage: any
}

const shader = `
struct Parameters {
  outWidth: u32, outHeight: u32, srcWidth: u32, srcHeight: u32,
  yOffset: u32, yStride: u32, uOffset: u32, uStride: u32,
  vOffset: u32, vStride: u32, transferMode: u32, yPacks: u32,
  uvPacks: u32, visibleX: u32, visibleY: u32, visibleWidth: u32,
  visibleHeight: u32, drawWidth: f32, drawHeight: f32, centerX: f32,
  centerY: f32, inverseScaleX: f32, inverseScaleY: f32, anchorX: f32,
  anchorY: f32, skewX: f32, skewY: f32, inverseSkewDet: f32,
  cosAngle: f32, sinAngle: f32, opacity: f32,
}
@group(0) @binding(0) var<storage, read> source: array<u32>;
@group(0) @binding(1) var<storage, read_write> packed: array<u32>;
@group(0) @binding(2) var<uniform> params: Parameters;

fn read_u16(offset: u32) -> f32 {
  let word = source[offset / 4u];
  let shift = (offset & 2u) * 8u;
  return f32((word >> shift) & 65535u);
}

fn plane_value(offset: u32, stride: u32, x: u32, y: u32) -> f32 {
  return read_u16(offset + y * stride + x * 2u);
}

fn bilinear_plane(offset: u32, stride: u32, width: u32, height: u32, position: vec2<f32>) -> f32 {
  let bounded = clamp(position, vec2<f32>(0.0), vec2<f32>(f32(width - 1u), f32(height - 1u)));
  let first = vec2<u32>(floor(bounded));
  let next = min(first + vec2<u32>(1u), vec2<u32>(width - 1u, height - 1u));
  let fraction = fract(bounded);
  let top = mix(plane_value(offset, stride, first.x, first.y), plane_value(offset, stride, next.x, first.y), fraction.x);
  let bottom = mix(plane_value(offset, stride, first.x, next.y), plane_value(offset, stride, next.x, next.y), fraction.x);
  return mix(top, bottom, fraction.y);
}

fn pq_inverse(value: f32) -> f32 {
  let m1 = 0.1593017578125;
  let m2 = 78.84375;
  let c1 = 0.8359375;
  let c2 = 18.8515625;
  let c3 = 18.6875;
  let power = pow(clamp(value, 0.0, 1.0), 1.0 / m2);
  return pow(max((power - c1) / max(c2 - c3 * power, 0.000001), 0.0), 1.0 / m1);
}

fn pq_forward(value: f32) -> f32 {
  let m1 = 0.1593017578125;
  let m2 = 78.84375;
  let c1 = 0.8359375;
  let c2 = 18.8515625;
  let c3 = 18.6875;
  let level = pow(clamp(value, 0.0, 1.0), m1);
  return pow((c1 + c2 * level) / (1.0 + c3 * level), m2);
}

fn hlg_inverse(value: f32) -> f32 {
  let a = 0.17883277;
  let b = 0.28466892;
  let c = 0.55991073;
  if (value <= 0.5) { return value * value / 3.0; }
  return (exp((value - c) / a) + b) / 12.0;
}

fn hlg_forward(value: f32) -> f32 {
  let a = 0.17883277;
  let b = 0.28466892;
  let c = 0.55991073;
  if (value <= 0.0833333333) { return sqrt(3.0 * max(value, 0.0)); }
  return a * log(12.0 * value - b) + c;
}

fn linear_pixel(position: vec2<u32>) -> vec3<f32> {
  let centered = vec2<f32>(f32(position.x) + 0.5 - params.centerX, f32(position.y) + 0.5 - params.centerY);
  let rotated = vec2<f32>(params.cosAngle * centered.x + params.sinAngle * centered.y, -params.sinAngle * centered.x + params.cosAngle * centered.y);
  let unskewed = vec2<f32>((rotated.x - params.skewX * rotated.y) * params.inverseSkewDet, (rotated.y - params.skewY * rotated.x) * params.inverseSkewDet);
  let local = vec2<f32>(
    unskewed.x * params.inverseScaleX + params.anchorX,
    unskewed.y * params.inverseScaleY + params.anchorY
  );
  if (local.x < 0.0 || local.y < 0.0 || local.x >= params.drawWidth || local.y >= params.drawHeight) { return vec3<f32>(0.0); }
  let sourcePosition = vec2<f32>(f32(params.visibleX), f32(params.visibleY)) + vec2<f32>(local.x / params.drawWidth, local.y / params.drawHeight) * vec2<f32>(f32(params.visibleWidth), f32(params.visibleHeight));
  let y = (bilinear_plane(params.yOffset, params.yStride, params.srcWidth, params.srcHeight, sourcePosition) - 64.0) / 876.0;
  let chromaPosition = sourcePosition * 0.5;
  let cb = (bilinear_plane(params.uOffset, params.uStride, (params.srcWidth + 1u) / 2u, (params.srcHeight + 1u) / 2u, chromaPosition) - 512.0) / 896.0;
  let cr = (bilinear_plane(params.vOffset, params.vStride, (params.srcWidth + 1u) / 2u, (params.srcHeight + 1u) / 2u, chromaPosition) - 512.0) / 896.0;
  let encoded = clamp(vec3<f32>(y + 1.4746 * cr, y - 0.164553 * cb - 0.571353 * cr, y + 1.8814 * cb), vec3<f32>(0.0), vec3<f32>(1.0));
  let linear = select(vec3<f32>(hlg_inverse(encoded.r), hlg_inverse(encoded.g), hlg_inverse(encoded.b)), vec3<f32>(pq_inverse(encoded.r), pq_inverse(encoded.g), pq_inverse(encoded.b)), params.transferMode == 0u);
  return linear * params.opacity;
}

fn encoded_pixel(position: vec2<u32>) -> vec3<f32> {
  let linear = linear_pixel(position);
  return select(vec3<f32>(hlg_forward(linear.r), hlg_forward(linear.g), hlg_forward(linear.b)), vec3<f32>(pq_forward(linear.r), pq_forward(linear.g), pq_forward(linear.b)), params.transferMode == 0u);
}

fn ycbcr(position: vec2<u32>) -> vec3<f32> {
  let rgb = encoded_pixel(position);
  let y = dot(rgb, vec3<f32>(0.2627, 0.6780, 0.0593));
  return vec3<f32>(y, (rgb.b - y) / 1.8814, (rgb.r - y) / 1.4746);
}

fn limited_y(value: f32) -> u32 { return u32(round(clamp(64.0 + 876.0 * value, 64.0, 940.0))); }
fn limited_c(value: f32) -> u32 { return u32(round(clamp(512.0 + 896.0 * value, 64.0, 960.0))); }

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let x = id.x * 2u;
  let y = id.y;
  if (x >= params.outWidth || y >= params.outHeight) { return; }
  let first = ycbcr(vec2<u32>(x, y));
  let second = ycbcr(vec2<u32>(min(x + 1u, params.outWidth - 1u), y));
  packed[y * (params.outWidth / 2u) + id.x] = limited_y(first.x) | (limited_y(second.x) << 16u);
  if ((y & 1u) == 0u && (id.x & 1u) == 0u) {
    let nextY = min(y + 1u, params.outHeight - 1u);
    let c0 = (first + second + ycbcr(vec2<u32>(x, nextY)) + ycbcr(vec2<u32>(min(x + 1u, params.outWidth - 1u), nextY))) * 0.25;
    let x2 = min(x + 2u, params.outWidth - 1u);
    let x3 = min(x + 3u, params.outWidth - 1u);
    let c1 = (ycbcr(vec2<u32>(x2, y)) + ycbcr(vec2<u32>(x3, y)) + ycbcr(vec2<u32>(x2, nextY)) + ycbcr(vec2<u32>(x3, nextY))) * 0.25;
    let uvIndex = (y / 2u) * (params.outWidth / 4u) + id.x / 2u;
    packed[params.yPacks + uvIndex] = limited_c(c0.y) | (limited_c(c1.y) << 16u);
    packed[params.yPacks + params.uvPacks + uvIndex] = limited_c(c0.z) | (limited_c(c1.z) << 16u);
  }
}`

export class HdrRawFrameTransformer {
  private resources?: Resources

  constructor(private width: number, private height: number, private transfer: HdrTransfer) {
    if (width % 4 || height % 2) throw new Error('10-bit HDR 출력 크기는 너비 4px·높이 2px 배수여야 합니다.')
  }

  async transform(frame: RawHdrFrame, transform: ClipTransform): Promise<HdrFrameData> {
    if (frame.layout.length < 3) throw new Error('HDR 원본의 10-bit YUV plane layout을 읽지 못했습니다.')
    const resources = await this.getResources()
    const inputLength = Math.ceil(frame.data.byteLength / 4) * 4
    if (!resources.input || resources.inputCapacity < inputLength) {
      resources.input?.destroy()
      resources.input = resources.device.createBuffer({ size: inputLength, usage: resources.usage.STORAGE | resources.usage.COPY_DST })
      resources.inputCapacity = inputLength
    }
    const padded = inputLength === frame.data.byteLength ? frame.data : new Uint8Array(inputLength)
    if (padded !== frame.data) padded.set(frame.data)
    resources.device.queue.writeBuffer(resources.input, 0, padded)
    const fitScale = Math.min(this.width / frame.displayWidth, this.height / frame.displayHeight)
    const drawWidth = frame.displayWidth * fitScale
    const drawHeight = frame.displayHeight * fitScale
    const radians = transform.rotation * Math.PI / 180
    const horizontalScale = transform.scale / 100 * (transform.scaleX ?? 100) / 100
    const verticalScale = transform.scale / 100 * (transform.scaleY ?? 100) / 100
    const safeHorizontalScale = Math.abs(horizontalScale) < 0.00001 ? (Math.sign(horizontalScale) || 1) * 0.00001 : horizontalScale
    const safeVerticalScale = Math.abs(verticalScale) < 0.00001 ? (Math.sign(verticalScale) || 1) * 0.00001 : verticalScale
    let skewX = Math.tan(Math.max(-85, Math.min(85, transform.skewX ?? 0)) * Math.PI / 180)
    let skewY = Math.tan(Math.max(-85, Math.min(85, transform.skewY ?? 0)) * Math.PI / 180)
    let skewDeterminant = 1 - skewX * skewY
    if (Math.abs(skewDeterminant) < 0.001) {
      if (Math.abs(skewX) > 0.001) skewY = (1 - (Math.sign(skewDeterminant) || 1) * 0.001) / skewX
      else skewX = (1 - (Math.sign(skewDeterminant) || 1) * 0.001) / Math.max(0.001, skewY)
      skewDeterminant = 1 - skewX * skewY
    }
    const integers = new Uint32Array([
      this.width, this.height, frame.codedWidth, frame.codedHeight,
      frame.layout[0].offset, frame.layout[0].stride, frame.layout[1].offset, frame.layout[1].stride,
      frame.layout[2].offset, frame.layout[2].stride, this.transfer === 'pq' ? 0 : 1, this.width * this.height / 2,
      this.width * this.height / 8, Math.round(frame.visibleRect.x), Math.round(frame.visibleRect.y), Math.round(frame.visibleRect.width),
      Math.round(frame.visibleRect.height),
    ])
    const floats = new Float32Array([drawWidth, drawHeight, this.width / 2 + transform.positionX, this.height / 2 + transform.positionY, 1 / safeHorizontalScale, 1 / safeVerticalScale, drawWidth * (transform.anchorX ?? 50) / 100, drawHeight * (transform.anchorY ?? 50) / 100, skewX, skewY, 1 / skewDeterminant, Math.cos(radians), Math.sin(radians), Math.max(0, Math.min(1, transform.opacity / 100))])
    const parameters = new ArrayBuffer(128)
    new Uint32Array(parameters, 0, integers.length).set(integers)
    new Float32Array(parameters, integers.byteLength, floats.length).set(floats)
    resources.device.queue.writeBuffer(resources.parameters, 0, parameters)
    const bindGroup = resources.device.createBindGroup({ layout: resources.pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: resources.input } }, { binding: 1, resource: { buffer: resources.output } }, { binding: 2, resource: { buffer: resources.parameters } }] })
    const encoder = resources.device.createCommandEncoder()
    const pass = encoder.beginComputePass()
    pass.setPipeline(resources.pipeline)
    pass.setBindGroup(0, bindGroup)
    pass.dispatchWorkgroups(Math.ceil(this.width / 16), Math.ceil(this.height / 8))
    pass.end()
    encoder.copyBufferToBuffer(resources.output, 0, resources.readback, 0, resources.outputByteLength)
    resources.device.queue.submit([encoder.finish()])
    await resources.readback.mapAsync(resources.mapMode.READ)
    const data = new Uint8Array(resources.readback.getMappedRange()).slice()
    resources.readback.unmap()
    const lumaBytes = this.width * this.height * 2
    const chromaBytes = this.width * this.height / 2
    return {
      data,
      layout: [{ offset: 0, stride: this.width * 2 }, { offset: lumaBytes, stride: this.width }, { offset: lumaBytes + chromaBytes, stride: this.width }],
      colorSpace: { primaries: 'bt2020', transfer: this.transfer, matrix: 'bt2020-ncl', fullRange: false } as unknown as VideoColorSpaceInit,
    }
  }

  destroy(): void {
    this.resources?.input?.destroy()
    this.resources?.output.destroy()
    this.resources?.readback.destroy()
    this.resources?.parameters.destroy()
    this.resources = undefined
  }

  private async getResources(): Promise<Resources> {
    if (this.resources) return this.resources
    const gpu = (navigator as Navigator & { gpu?: any }).gpu
    if (!gpu) throw new Error('원본 10-bit HDR 변형에는 WebGPU를 지원하는 GPU와 드라이버가 필요합니다.')
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' })
    if (!adapter) throw new Error('원본 10-bit HDR 변형용 GPU 어댑터를 찾지 못했습니다.')
    const device = await adapter.requestDevice()
    const yPacks = this.width * this.height / 2
    const uvPacks = this.width * this.height / 8
    const outputByteLength = (yPacks + uvPacks * 2) * 4
    const usage = (globalThis as any).GPUBufferUsage
    const mapMode = (globalThis as any).GPUMapMode
    if (!usage || !mapMode) throw new Error('WebGPU 버퍼 상수를 사용할 수 없습니다.')
    const output = device.createBuffer({ size: outputByteLength, usage: usage.STORAGE | usage.COPY_SRC })
    const readback = device.createBuffer({ size: outputByteLength, usage: usage.COPY_DST | usage.MAP_READ })
    const parameters = device.createBuffer({ size: 128, usage: usage.UNIFORM | usage.COPY_DST })
    const module = device.createShaderModule({ code: shader })
    const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } })
    this.resources = { device, pipeline, output, readback, parameters, inputCapacity: 0, outputByteLength, mapMode, usage }
    return this.resources
  }
}
