import { getMoonrakerBaseUrl } from '@/utils/env'
import { isPreview, previewResponse } from '@/utils/preview'

class ApiError extends Error {
  status: number
  body: string
  constructor(message: string, status: number, body: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

const REQUEST_TIMEOUT_MS = 10000

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (isPreview) {
    if (options.method && options.method !== 'GET')
      throw new Error('Printer actions are disabled in preview')
    return previewResponse(path) as T
  }
  const url = `${getMoonrakerBaseUrl()}${path}`

  const resp = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  if (!resp.ok) {
    const body = await resp.text().catch(() => '')
    throw new ApiError(
      `HTTP ${resp.status}: ${resp.statusText}`,
      resp.status,
      body,
    )
  }

  const contentType = resp.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    return resp.json()
  }
  return resp.text() as unknown as T
}

export const api = {
  get<T>(path: string) {
    return request<T>(path)
  },
  post<T>(path: string, body?: unknown) {
    return request<T>(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
  },
  delete<T>(path: string) {
    return request<T>(path, { method: 'DELETE' })
  },
  /**
   * Multipart upload (used by the Klipper config editor to PUT files).
   * Bypasses the JSON encoding of `post` and lets the caller supply a FormData body.
   */
  async upload<T = unknown>(
    path: string,
    form: FormData,
    timeoutMs = REQUEST_TIMEOUT_MS,
  ): Promise<T> {
    if (isPreview) throw new Error('Uploads are disabled in preview')
    const resp = await fetch(`${getMoonrakerBaseUrl()}${path}`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!resp.ok) {
      const body = await resp.text().catch(() => '')
      throw new ApiError(
        `HTTP ${resp.status}: ${resp.statusText}`,
        resp.status,
        body,
      )
    }
    return resp.json().catch(() => undefined) as T
  },
}
