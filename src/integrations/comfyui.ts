export type ComfyWorkflow = Record<string, { class_type?: string; inputs?: Record<string, unknown>; [key: string]: unknown }>

export interface ComfyRunProgress {
  progress: number
  stage: string
}

interface UploadedImage {
  name: string
  subfolder?: string
  type?: string
}

interface HistoryImage {
  filename: string
  subfolder?: string
  type?: string
}

function endpointUrl(endpoint: string, path: string): string {
  const base = endpoint.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(base)) throw new Error('ComfyUI 주소는 http:// 또는 https://로 시작해야 합니다.')
  return `${base}${path}`
}

export async function checkComfyUi(endpoint: string, signal?: AbortSignal): Promise<void> {
  const response = await fetch(endpointUrl(endpoint, '/system_stats'), { signal })
  if (!response.ok) throw new Error(`ComfyUI 연결 실패: HTTP ${response.status}`)
}

export function parseComfyWorkflow(raw: string): ComfyWorkflow {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new Error('워크플로 JSON 문법이 올바르지 않습니다.')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('ComfyUI API 형식 워크플로가 아닙니다.')
  const workflow = value as ComfyWorkflow
  if (!Object.values(workflow).some((node) => node && typeof node === 'object' && typeof node.class_type === 'string')) {
    throw new Error('노드의 class_type이 없습니다. ComfyUI에서 API 형식으로 저장한 워크플로를 사용해주세요.')
  }
  return workflow
}

export async function runComfyImageWorkflow(options: {
  endpoint: string
  workflow: ComfyWorkflow
  input: File
  signal?: AbortSignal
  onProgress?: (progress: ComfyRunProgress) => void
}): Promise<File> {
  const { endpoint, workflow, input, signal, onProgress } = options
  onProgress?.({ progress: 0.03, stage: 'ComfyUI 연결 확인' })
  await checkComfyUi(endpoint, signal)
  throwIfAborted(signal)

  onProgress?.({ progress: 0.1, stage: '입력 이미지 업로드' })
  const uploaded = await uploadImage(endpoint, input, signal)
  const prompt = injectInputImage(workflow, uploaded)
  const clientId = crypto.randomUUID()

  onProgress?.({ progress: 0.18, stage: '워크플로 큐 등록' })
  const queued = await fetch(endpointUrl(endpoint, '/prompt'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, client_id: clientId }),
    signal,
  })
  const queueBody = await queued.json().catch(() => ({})) as { prompt_id?: string; error?: string; node_errors?: unknown }
  if (!queued.ok || !queueBody.prompt_id) {
    const details = queueBody.error || (queueBody.node_errors ? JSON.stringify(queueBody.node_errors) : `HTTP ${queued.status}`)
    throw new Error(`ComfyUI 워크플로 등록 실패: ${details}`)
  }

  const cancelQueuedPrompt = () => {
    void fetch(endpointUrl(endpoint, '/queue'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delete: [queueBody.prompt_id] }),
    }).catch(() => undefined)
  }
  signal?.addEventListener('abort', cancelQueuedPrompt, { once: true })
  let output: HistoryImage
  try {
    output = await waitForOutput(endpoint, queueBody.prompt_id, signal, onProgress)
  } finally {
    signal?.removeEventListener('abort', cancelQueuedPrompt)
  }
  onProgress?.({ progress: 0.94, stage: '결과 이미지 다운로드' })
  const query = new URLSearchParams({ filename: output.filename, subfolder: output.subfolder ?? '', type: output.type ?? 'output' })
  const result = await fetch(endpointUrl(endpoint, `/view?${query.toString()}`), { signal })
  if (!result.ok) throw new Error(`ComfyUI 결과 다운로드 실패: HTTP ${result.status}`)
  const blob = await result.blob()
  const extension = output.filename.split('.').pop()?.toLowerCase() || (blob.type.includes('jpeg') ? 'jpg' : 'png')
  const base = input.name.replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*]+/g, '-') || 'comfy-result'
  onProgress?.({ progress: 1, stage: '완료' })
  return new File([blob], `${base}-comfyui.${extension}`, { type: blob.type || `image/${extension}` })
}

async function uploadImage(endpoint: string, input: File, signal?: AbortSignal): Promise<UploadedImage> {
  const form = new FormData()
  form.append('image', input, input.name)
  form.append('type', 'input')
  form.append('overwrite', 'true')
  const response = await fetch(endpointUrl(endpoint, '/upload/image'), { method: 'POST', body: form, signal })
  const body = await response.json().catch(() => ({})) as Partial<UploadedImage>
  if (!response.ok || !body.name) throw new Error(`ComfyUI 이미지 업로드 실패: HTTP ${response.status}`)
  return { name: body.name, subfolder: body.subfolder, type: body.type }
}

function injectInputImage(workflow: ComfyWorkflow, uploaded: UploadedImage): ComfyWorkflow {
  const clone = structuredClone(workflow)
  const imageName = uploaded.subfolder ? `${uploaded.subfolder}/${uploaded.name}` : uploaded.name
  let replaced = 0
  for (const node of Object.values(clone)) {
    if (!node?.inputs) continue
    for (const [key, value] of Object.entries(node.inputs)) {
      if (value === '{{CUTLINE_INPUT}}') {
        node.inputs[key] = imageName
        replaced++
      }
    }
    if (node.class_type === 'LoadImage' && typeof node.inputs.image === 'string' && replaced === 0) {
      node.inputs.image = imageName
      replaced++
    }
  }
  if (!replaced) throw new Error('워크플로에서 LoadImage 노드 또는 {{CUTLINE_INPUT}} 자리표시자를 찾지 못했습니다.')
  return clone
}

async function waitForOutput(
  endpoint: string,
  promptId: string,
  signal: AbortSignal | undefined,
  onProgress?: (progress: ComfyRunProgress) => void,
): Promise<HistoryImage> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 30 * 60 * 1000) {
    throwIfAborted(signal)
    const response = await fetch(endpointUrl(endpoint, `/history/${encodeURIComponent(promptId)}`), { signal })
    if (!response.ok) throw new Error(`ComfyUI 실행 상태 확인 실패: HTTP ${response.status}`)
    const history = await response.json() as Record<string, { outputs?: Record<string, { images?: HistoryImage[] }>; status?: { status_str?: string; messages?: unknown } }>
    const record = history[promptId]
    if (record) {
      if (record.status?.status_str === 'error') throw new Error(`ComfyUI 실행 실패: ${JSON.stringify(record.status.messages ?? {})}`)
      const images = Object.values(record.outputs ?? {}).flatMap((output) => output.images ?? [])
      if (images.length) return images[images.length - 1]
    }
    const elapsed = (Date.now() - startedAt) / 1000
    onProgress?.({ progress: Math.min(0.9, 0.22 + Math.log2(elapsed + 1) * 0.08), stage: 'ComfyUI 워크플로 실행 중' })
    await delay(800, signal)
  }
  throw new Error('ComfyUI 실행이 30분 안에 완료되지 않았습니다.')
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const handleAbort = () => {
      window.clearTimeout(timer)
      reject(new DOMException('ComfyUI 작업을 취소했습니다.', 'AbortError'))
    }
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', handleAbort)
      resolve()
    }, milliseconds)
    signal?.addEventListener('abort', handleAbort, { once: true })
  })
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('ComfyUI 작업을 취소했습니다.', 'AbortError')
}
