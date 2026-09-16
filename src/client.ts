import type { JsonValue } from '@deepseek-ai/dsh-util-values'

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'succeeded', 'cancelled', 'expired'])
const RETRYABLE_STATUS_CODES = new Set([408, 409, 425, 429])
const MAX_RESULT_URLS = 32
const MAX_URL_SCAN_NODES = 2_000
const MAX_URL_SCAN_DEPTH = 10

export type TokenLabTask = Record<string, JsonValue>

export interface TaskFetchResult {
  task: TokenLabTask
  requestId?: string
}

export interface WaitForTaskOptions {
  apiBase: string
  apiKey: string
  id: string
  pollIntervalMs: number
  timeoutMs: number
  maxTransientErrors: number
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}

export interface WaitForTaskResult {
  id: string
  status: string
  terminal: boolean
  timedOut: boolean
  attempts: number
  elapsedMs: number
  transientErrors: number
  resultUrls: string[]
  response: TokenLabTask | null
  lastRequestId?: string
}

export class TokenLabHttpError extends Error {
  readonly status: number
  readonly code?: string
  readonly requestId?: string
  readonly retryAfterMs?: number

  constructor(
    message: string,
    options: {
      status: number
      code?: string
      requestId?: string
      retryAfterMs?: number
      cause?: unknown
    },
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'TokenLabHttpError'
    this.status = options.status
    if (options.code !== undefined) this.code = options.code
    if (options.requestId !== undefined) this.requestId = options.requestId
    if (options.retryAfterMs !== undefined) this.retryAfterMs = options.retryAfterMs
  }

  get retryable(): boolean {
    return RETRYABLE_STATUS_CODES.has(this.status) || this.status >= 500
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorFields(value: unknown): { code?: string; message?: string } {
  if (!isRecord(value)) return {}
  const candidate = isRecord(value.error) ? value.error : value
  return {
    ...(typeof candidate.code === 'string' ? { code: candidate.code } : {}),
    ...(typeof candidate.message === 'string' ? { message: candidate.message } : {}),
  }
}

function retryAfterMs(value: string | null): number | undefined {
  if (value === null) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000)
  const date = Date.parse(value)
  if (!Number.isFinite(date)) return undefined
  return Math.max(0, date - Date.now())
}

function taskUrl(apiBase: string, id: string): URL {
  const base = apiBase.trim().replace(/\/+$/, '')
  if (base.length === 0) throw new Error('TokenLab API base URL must not be empty')
  const parsed = new URL(base)
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`Unsupported TokenLab API base protocol: ${parsed.protocol}`)
  }
  const root = parsed.pathname.replace(/\/+$/, '').endsWith('/v1')
    ? base
    : `${base}/v1`
  return new URL(`${root}/tasks/${encodeURIComponent(id)}`)
}

function assertTaskId(id: string): string {
  const normalized = id.trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(normalized)) {
    throw new Error('Task id must be 1-256 characters using letters, numbers, dot, underscore, colon, or hyphen')
  }
  return normalized
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text.length === 0) return null
  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    const requestId = response.headers.get('x-request-id') ?? undefined
    throw new TokenLabHttpError(
      `TokenLab returned non-JSON content with HTTP ${response.status}`,
      {
        status: response.status,
        ...(requestId === undefined ? {} : { requestId }),
        cause: error,
      },
    )
  }
}

export async function fetchTask(options: {
  apiBase: string
  apiKey: string
  id: string
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}): Promise<TaskFetchResult> {
  if (options.apiKey.length === 0) {
    throw new Error('TOKENLAB_API_KEY is required to read an async task')
  }
  const fetchImpl = options.fetchImpl ?? fetch
  const response = await fetchImpl(taskUrl(options.apiBase, assertTaskId(options.id)), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${options.apiKey}`,
    },
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
  const body = await parseJsonResponse(response)
  const requestId = response.headers.get('x-request-id') ?? undefined
  if (!response.ok) {
    const fields = errorFields(body)
    const retryAfter = retryAfterMs(response.headers.get('retry-after'))
    throw new TokenLabHttpError(
      fields.message ?? `TokenLab task request failed with HTTP ${response.status}`,
      {
        status: response.status,
        ...(fields.code === undefined ? {} : { code: fields.code }),
        ...(requestId === undefined ? {} : { requestId }),
        ...(retryAfter === undefined ? {} : { retryAfterMs: retryAfter }),
      },
    )
  }
  if (!isRecord(body)) {
    throw new TokenLabHttpError('TokenLab task response must be a JSON object', {
      status: response.status,
      ...(requestId === undefined ? {} : { requestId }),
    })
  }
  return {
    task: body as TokenLabTask,
    ...(requestId === undefined ? {} : { requestId }),
  }
}

function taskStatus(task: TokenLabTask): string {
  if (typeof task.status !== 'string' || task.status.length === 0) {
    throw new Error('TokenLab task response is missing a non-empty status')
  }
  return task.status.toLowerCase()
}

export function extractResultUrls(value: unknown): string[] {
  const urls = new Set<string>()
  const queue: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }]
  let visited = 0
  while (queue.length > 0 && urls.size < MAX_RESULT_URLS && visited < MAX_URL_SCAN_NODES) {
    const current = queue.shift()
    if (current === undefined) break
    visited++
    if (typeof current.value === 'string') {
      if (/^https?:\/\//i.test(current.value)) urls.add(current.value)
      continue
    }
    if (current.depth >= MAX_URL_SCAN_DEPTH || current.value === null || typeof current.value !== 'object') continue
    if (Array.isArray(current.value)) {
      for (const item of current.value) queue.push({ value: item, depth: current.depth + 1 })
      continue
    }
    for (const item of Object.values(current.value)) queue.push({ value: item, depth: current.depth + 1 })
  }
  return [...urls]
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    const finish = (): void => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }
    const timer = setTimeout(finish, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      reject(signal.reason)
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export async function waitForTask(options: WaitForTaskOptions): Promise<WaitForTaskResult> {
  const startedAt = Date.now()
  const timeout = AbortSignal.timeout(options.timeoutMs)
  const signal = options.signal === undefined ? timeout : AbortSignal.any([options.signal, timeout])
  let attempts = 0
  let transientErrors = 0
  let consecutiveTransientErrors = 0
  let last: TaskFetchResult | undefined

  try {
    while (true) {
      signal.throwIfAborted()
      try {
        attempts++
        last = await fetchTask({
          apiBase: options.apiBase,
          apiKey: options.apiKey,
          id: options.id,
          signal,
          ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
        })
        consecutiveTransientErrors = 0
        const status = taskStatus(last.task)
        if (TERMINAL_STATUSES.has(status)) {
          return {
            id: options.id,
            status,
            terminal: true,
            timedOut: false,
            attempts,
            elapsedMs: Date.now() - startedAt,
            transientErrors,
            resultUrls: extractResultUrls(last.task),
            response: last.task,
            ...(last.requestId === undefined ? {} : { lastRequestId: last.requestId }),
          }
        }
      } catch (error) {
        if (!(error instanceof TokenLabHttpError) || !error.retryable) throw error
        transientErrors++
        consecutiveTransientErrors++
        if (consecutiveTransientErrors > options.maxTransientErrors) throw error
        const retryDelay = Math.max(options.pollIntervalMs, error.retryAfterMs ?? 0)
        await delay(retryDelay, signal)
        continue
      }
      await delay(options.pollIntervalMs, signal)
    }
  } catch (error) {
    if (!timeout.aborted || options.signal?.aborted === true) throw error
    const status = last === undefined ? 'unknown' : taskStatus(last.task)
    return {
      id: options.id,
      status,
      terminal: false,
      timedOut: true,
      attempts,
      elapsedMs: Date.now() - startedAt,
      transientErrors,
      resultUrls: extractResultUrls(last?.task),
      response: last?.task ?? null,
      ...(last?.requestId === undefined ? {} : { lastRequestId: last.requestId }),
    }
  }
}
