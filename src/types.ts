// ---------------------------------------------------------------------------
// @moyin/net-client — Type definitions (framework-agnostic)
// ---------------------------------------------------------------------------

import type { NetError } from './errors'

/** Execution environment */
export type NetEnvMode = 'mock' | 'real'

/** Request mode */
export type NetRequestMode = 'rest' | 'stream'

/** Request concurrency policy */
export type NetPolicy = 'parallel' | 'serial' | 'takeLatest' | 'dedupe'

/** Loading state tracking scope */
export type NetTrackLoading = 'global' | 'scope' | 'none'

/** Cancel reason */
export type CancelReason =
  | 'user'
  | 'latest_replaced'
  | 'timeout'
  | 'unknown'

/** HTTP method */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export interface NetRetryOptions {
  maxRetries?: number
  baseDelayMs?: number
  backoffFactor?: number
  retryOnStatuses?: number[]
}

export interface NetRequest {
  method: HttpMethod
  url: string
  data?: unknown
  params?: Record<string, unknown>
  headers?: Record<string, string>
  timeoutMs?: number

  requestKey?: string
  groupKey?: string
  policy?: NetPolicy

  mock?: boolean
  caseName?: string

  trackLoading?: NetTrackLoading
  scopeId?: string
  silent?: boolean

  retry?: NetRetryOptions
  retryId?: string

  onProgress?: (event: NetProgressEvent) => void
  allowLateResponse?: boolean

  signal?: AbortSignal
}


// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

export type NetFinalState =
  | 'ok'
  | 'canceled'
  | 'stale_discarded'
  | 'late_discarded'
  | 'error'
  | 'pending'

export interface NetResult<T = unknown> {
  ok: boolean
  requestId: string
  requestKey: string
  status?: number
  data?: T
  error?: NetError
  durationMs: number
  retryCount: number
  finalState: NetFinalState
  deduped?: boolean
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export interface NetProgressEvent {
  requestId: string
  requestKey: string
  scopeId?: string
  type: 'download' | 'upload'
  loaded: number
  total?: number
  percent?: number
}

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------

export interface NetStreamChunk {
  index: number
  text: string
  raw?: unknown
  done?: boolean
}

export interface NetStreamHandle {
  requestId: string
  requestKey: string
  cancel: () => void
  onChunk: (handler: (chunk: NetStreamChunk) => void) => void
  onDone: (handler: () => void) => void
  onError: (handler: (error: NetError) => void) => void
}

// ---------------------------------------------------------------------------
// Trace
// ---------------------------------------------------------------------------

export type NetTraceEventType =
  | 'request_start'
  | 'request_progress'
  | 'request_retry'
  | 'request_cancel'
  | 'stream_chunk'
  | 'late_response_discarded'
  | 'request_deduped'
  | 'request_end'

export interface NetTraceEvent {
  eventType: NetTraceEventType
  ts: string
  caseName?: string
  requestId: string
  requestKey?: string
  groupKey?: string
  policy: NetPolicy
  mode: NetRequestMode
  env: NetEnvMode
  status: 'pending' | 'ok' | 'error' | 'canceled' | 'stale' | 'timeout' | 'late_discarded'
  finalState: NetFinalState | 'missing'
  durationMs: number
  cancelReason?: CancelReason
  replacedByRequestId?: string
  retryCount?: number
  chunkIndex?: number
  chunkCount?: number
  progress?: number
  errorCode?: string
  errorMessage?: string
  notes?: string
  deduped?: boolean
  httpStatus?: number
}

export interface NetTraceMeta {
  runId: string
  generatedAt: string
  appVersion?: string
  env?: NetEnvMode
  note?: string
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export interface NetNotice {
  type: 'info' | 'warn' | 'error'
  messageKey?: string
  message?: string
  ts: string
}

export interface NetStoreSnapshot {
  globalLoadingCount: number
  scopeLoading: Record<string, number>
  isOffline: boolean
  isFlaky: boolean
  lastNotice: NetNotice | null
}

// ---------------------------------------------------------------------------
// Mock
// ---------------------------------------------------------------------------

export interface MockRoute {
  method: HttpMethod
  path: string
  handler: (params?: Record<string, string>, body?: unknown) => unknown
  delay?: number
}

export interface MockStreamRoute {
  path: string
  handler: (
    params?: Record<string, string>,
    onChunk?: (text: string) => void,
  ) => Promise<void>
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface NetClientConfig {
  baseUrl?: string
  defaultTimeoutMs?: number
  defaultHeaders?: Record<string, string>
  getAuthToken?: () => string | null | Promise<string | null>
  mode?: NetEnvMode
  isDev?: boolean
}
