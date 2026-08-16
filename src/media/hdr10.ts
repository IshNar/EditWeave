import { HLG_SDR_WHITE_SCENE, SDR_REFERENCE_WHITE_NITS } from './colorConformance'

type HdrTransfer = 'pq' | 'hlg'

export interface HdrFrameData {
  data: Uint8Array
  layout: PlaneLayout[]
  colorSpace: VideoColorSpaceInit
}

interface GpuResources {
  device: any
  pipeline: any
  bindGroup: any
  texture: any
  output: any
  readback: any
  parameters: any
  byteLength: number
  mapMode: any
}

const shader = `
struct Parameters { width: u32, height: u32, mode: u32, yPacks: u32, uvPacks: u32 }
@group(0) @binding(0) var frame: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> packed: array<u32>;
@group(0) @binding(2) var<uniform> params: Parameters;

fn srgb_to_linear(value: f32) -> f32 {
  return select(value / 12.92, pow((value + 0.055) / 1.055, 2.4), value > 0.04045);
}

fn pq(value: f32) -> f32 {
  let m1 = 0.1593017578125;
  let m2 = 78.84375;
  let c1 = 0.8359375;
  let c2 = 18.8515625;
  let c3 = 18.6875;
  let level = pow(clamp(value * ${SDR_REFERENCE_WHITE_NITS.toFixed(1)} / 10000.0, 0.0, 1.0), m1);
  return pow((c1 + c2 * level) / (1.0 + c3 * level), m2);
}

fn hlg(value: f32) -> f32 {
  let scene = max(0.0, value * ${HLG_SDR_WHITE_SCENE.toFixed(9)});
  let a = 0.17883277;
  let b = 0.28466892;
  let c = 0.55991073;
  if (scene <= 0.0833333333) { return sqrt(3.0 * scene); }
  return a * log(12.0 * scene - b) + c;
}

fn encoded_rgb(position: vec2<u32>) -> vec3<f32> {
  let rgba = textureLoad(frame, vec2<i32>(position), 0);
  let linear709 = vec3<f32>(srgb_to_linear(rgba.r), srgb_to_linear(rgba.g), srgb_to_linear(rgba.b));
  let linear2020 = max(vec3<f32>(0.0), vec3<f32>(
    dot(linear709, vec3<f32>(0.6274040, 0.3292820, 0.0433136)),
    dot(linear709, vec3<f32>(0.0690970, 0.9195400, 0.0113612)),
    dot(linear709, vec3<f32>(0.0163916, 0.0880132, 0.8955950))
  ));
  if (params.mode == 0u) { return vec3<f32>(pq(linear2020.r), pq(linear2020.g), pq(linear2020.b)); }
  return vec3<f32>(hlg(linear2020.r), hlg(linear2020.g), hlg(linear2020.b));
}

fn ycbcr(position: vec2<u32>) -> vec3<f32> {
  let rgb = encoded_rgb(position);
  let y = dot(rgb, vec3<f32>(0.2627, 0.6780, 0.0593));
  return vec3<f32>(y, (rgb.b - y) / 1.8814, (rgb.r - y) / 1.4746);
}

fn limited_y(value: f32) -> u32 { return u32(round(clamp(64.0 + 876.0 * value, 64.0, 940.0))); }
fn limited_c(value: f32) -> u32 { return u32(round(clamp(512.0 + 896.0 * value, 64.0, 960.0))); }

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let x = id.x * 2u;
  let y = id.y;
  if (x >= params.width || y >= params.height) { return; }
  let first = ycbcr(vec2<u32>(x, y));
  let second = ycbcr(vec2<u32>(min(x + 1u, params.width - 1u), y));
  packed[y * (params.width / 2u) + id.x] = limited_y(first.x) | (limited_y(second.x) << 16u);
  if ((y & 1u) == 0u && (id.x & 1u) == 0u) {
    let nextY = min(y + 1u, params.height - 1u);
    let c0 = (first + second + ycbcr(vec2<u32>(x, nextY)) + ycbcr(vec2<u32>(min(x + 1u, params.width - 1u), nextY))) * 0.25;
    let x2 = min(x + 2u, params.width - 1u);
    let x3 = min(x + 3u, params.width - 1u);
    let c1 = (ycbcr(vec2<u32>(x2, y)) + ycbcr(vec2<u32>(x3, y)) + ycbcr(vec2<u32>(x2, nextY)) + ycbcr(vec2<u32>(x3, nextY))) * 0.25;
    let uvIndex = (y / 2u) * (params.width / 4u) + id.x / 2u;
    packed[params.yPacks + uvIndex] = limited_c(c0.y) | (limited_c(c1.y) << 16u);
    packed[params.yPacks + params.uvPacks + uvIndex] = limited_c(c0.z) | (limited_c(c1.z) << 16u);
  }
}`

export class Hdr10FrameConverter {
  private resources?: GpuResources

  constructor(private width: number, private height: number, private transfer: HdrTransfer) {
    if (width % 4 || height % 2) throw new Error('10-bit HDR 출력 크기는 너비 4px·높이 2px 배수여야 합니다.')
  }

  async convert(canvas: HTMLCanvasElement): Promise<HdrFrameData> {
    const resources = await this.getResources()
    resources.device.queue.copyExternalImageToTexture({ source: canvas }, { texture: resources.texture }, { width: this.width, height: this.height })
    const encoder = resources.device.createCommandEncoder()
    const pass = encoder.beginComputePass()
    pass.setPipeline(resources.pipeline)
    pass.setBindGroup(0, resources.bindGroup)
    pass.dispatchWorkgroups(Math.ceil(this.width / 16), Math.ceil(this.height / 8))
    pass.end()
    encoder.copyBufferToBuffer(resources.output, 0, resources.readback, 0, resources.byteLength)
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
    this.resources?.texture.destroy()
    this.resources?.output.destroy()
    this.resources?.readback.destroy()
    this.resources?.parameters.destroy()
    this.resources = undefined
  }

  private async getResources(): Promise<GpuResources> {
    if (this.resources) return this.resources
    const gpu = (navigator as Navigator & { gpu?: any }).gpu
    if (!gpu) throw new Error('10-bit HDR 합성에는 WebGPU를 지원하는 GPU와 드라이버가 필요합니다.')
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' })
    if (!adapter) throw new Error('10-bit HDR 합성용 GPU 어댑터를 찾지 못했습니다.')
    const device = await adapter.requestDevice()
    const yPacks = this.width * this.height / 2
    const uvPacks = this.width * this.height / 8
    const byteLength = (yPacks + uvPacks * 2) * 4
    const usage = (globalThis as any).GPUBufferUsage
    const textureUsage = (globalThis as any).GPUTextureUsage
    const mapMode = (globalThis as any).GPUMapMode
    if (!usage || !textureUsage || !mapMode) throw new Error('WebGPU 버퍼 상수를 사용할 수 없습니다.')
    const texture = device.createTexture({ size: [this.width, this.height], format: 'rgba8unorm', usage: textureUsage.COPY_DST | textureUsage.TEXTURE_BINDING })
    const output = device.createBuffer({ size: byteLength, usage: usage.STORAGE | usage.COPY_SRC })
    const readback = device.createBuffer({ size: byteLength, usage: usage.COPY_DST | usage.MAP_READ })
    const parameters = device.createBuffer({ size: 32, usage: usage.UNIFORM | usage.COPY_DST })
    device.queue.writeBuffer(parameters, 0, new Uint32Array([this.width, this.height, this.transfer === 'pq' ? 0 : 1, yPacks, uvPacks]))
    const module = device.createShaderModule({ code: shader })
    const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } })
    const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: texture.createView() }, { binding: 1, resource: { buffer: output } }, { binding: 2, resource: { buffer: parameters } }] })
    this.resources = { device, pipeline, bindGroup, texture, output, readback, parameters, byteLength, mapMode }
    return this.resources
  }
}
