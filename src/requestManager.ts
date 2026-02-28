// ---------------------------------------------------------------------------
// @moyin/net-client — RequestManager (4 policies + retry + streaming)
// ---------------------------------------------------------------------------

import type {
  CancelReason,
  NetEnvMode,
  NetFinalState,
  NetPolicy,
  NetRequest,
  NetResult,
  NetStreamChunk,
  NetStreamHandle,
  NetTraceEvent,
  NetTraceEventType,
} from './types'
import {
  NetCanceledError,
  NetHttpError,
  NetLateDiscardedError,
  NetOfflineError,
  NetStaleDiscardedError,
  NetTimeoutError,
  isRetryableError,
  normalizeToNetError,
  resolveFinalStateFromError,
  type NetError,
} from './errors'
import { fetchRequest, getConfig, buildRequestInit } from './httpClient'
import { mockFetch, mockStream as mockStreamFetch } from './mockTransport'
import { startLoading, endLoading, setOffline, recordNetworkResult } from './netStore'
import { pushNetTrace } from './trace'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

function resolveRequestKey(opts: NetRequest, fallbackId: string): string {
  return opts.requestKey ?? opts.groupKey ?? fallbackId
}

function resolvePolicy(opts: NetRequest): NetPolicy {
  return opts.policy ?? 'takeLatest'
}

function resolveTrackLoading(opts: NetRequest): 'global' | 'scope' | 'none' {
  if (opts.silent) return 'none'
  return opts.trackLoading ?? 'global'
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ---------------------------------------------------------------------------
// Request state
// ---------------------------------------------------------------------------

interface InflightEntry {
  requestId: string
  requestKey: string
  controller: AbortController
  cancelled: boolean
  cancelReason?: CancelReason
  startedAt: number
}

// ---------------------------------------------------------------------------
// RequestManager
// ---------------------------------------------------------------------------

export class RequestManager {
  readonly mode: NetEnvMode
  readonly isDev: boolean

  // Inflight tracking: requestId → entry
  private readonly inflight = new Map<string, InflightEntry>()

  // For takeLatest: requestKey → latest requestId
  private readonly latestByKey = new Map<string, string>()

  // For dedupe: requestKey → { promise, requestId }
  private readonly dedupeByKey = new Map<string, { promise: Promise<NetResult<unknown>>; requestId: string }>()

  // For serial: requestKey → queue of tasks
  private readonly serialQueues = new Map<string, Array<() => void>>()

  // Store handler refs for dispose()
  private onlineHandler: (() => void) | null = null
  private offlineHandler: (() => void) | null = null

  constructor(options: { mode: NetEnvMode; isDev?: boolean }) {
    this.mode = options.mode
    this.isDev = options.isDev ?? false

    // Offline detection
    if (typeof window !== 'undefined') {
      this.onlineHandler = () => setOffline(false)
      this.offlineHandler = () => setOffline(true)
      window.addEventListener('online', this.onlineHandler)
      window.addEventListener('offline', this.offlineHandler)
      if (!navigator.onLine) setOffline(true)
    }
  }

  dispose(): void {
    if (typeof window !== 'undefined') {
      if (this.onlineHandler) window.removeEventListener('online', this.onlineHandler)
      if (this.offlineHandler) window.removeEventListener('offline', this.offlineHandler)
    }
    this.onlineHandler = null
    this.offlineHandler = null
    // Cancel all inflight requests
    for (const entry of this.inflight.values()) {
      this.cancelEntry(entry, 'user')
    }
    this.inflight.clear()
    this.latestByKey.clear()
    this.dedupeByKey.clear()
    this.serialQueues.clear()
  }

  // -------------------------------------------------------------------------
  // REST request
  // -------------------------------------------------------------------------

  request<T = unknown>(opts: NetRequest): {
    requestId: string
    requestKey: string
    promise: Promise<NetResult<T>>
    cancel: () => void
  } {
    const requestId = createId('req')
    const requestKey = resolveRequestKey(opts, requestId)
    const policy = resolvePolicy(opts)
    const controller = new AbortController()

    const entry: InflightEntry = {
      requestId,
      requestKey,
      controller,
      cancelled: false,
      startedAt: Date.now(),
    }
    this.inflight.set(requestId, entry)

    const cancel = () => this.cancelEntry(entry, 'user')

    const promise = this.executeRequest<T>(opts, entry, policy)

    // Store promise for dedupe policy
    if (policy === 'dedupe') {
      this.dedupeByKey.set(requestKey, { promise: promise as Promise<NetResult<unknown>>, requestId })
    }

    return { requestId, requestKey, promise, cancel }
  }

  private async executeRequest<T>(
    opts: NetRequest,
    entry: InflightEntry,
    policy: NetPolicy,
  ): Promise<NetResult<T>> {
    const { requestId, requestKey } = entry
    const tracking = resolveTrackLoading(opts)
    const useMock = opts.mock ?? (this.mode === 'mock')

    // --- Policy: takeLatest → cancel previous ---
    if (policy === 'takeLatest') {
      const prevId = this.latestByKey.get(requestKey)
      if (prevId && prevId !== requestId) {
        const prev = this.inflight.get(prevId)
        if (prev && !prev.cancelled) {
          this.cancelEntry(prev, 'latest_replaced')
        }
      }
      this.latestByKey.set(requestKey, requestId)
    }

    // --- Policy: dedupe → return existing promise (skip self) ---
    if (policy === 'dedupe') {
      const existing = this.dedupeByKey.get(requestKey)
      if (existing && existing.requestId !== requestId) {
        this.inflight.delete(requestId)
        this.trace(opts, entry, 'request_deduped', 'pending', 'pending', { deduped: true })
        const result = await existing.promise as NetResult<T>
        return { ...result, requestId, deduped: true }
      }
    }

    // --- Policy: serial → wait for queue ---
    if (policy === 'serial') {
      await this.waitForSerialSlot(requestKey)
    }

    // --- Offline check (skip in mock mode) ---
    if (!useMock && typeof navigator !== 'undefined' && !navigator.onLine) {
      const error = new NetOfflineError(undefined, { requestId, requestKey })
      this.cleanup(entry, policy)
      recordNetworkResult(false)
      return this.buildResult<T>(entry, undefined, error, 0)
    }

    // --- Loading state ---
    if (tracking !== 'none') {
      startLoading(tracking === 'scope' ? opts.scopeId : undefined)
    }

    // --- Trace: start ---
    this.trace(opts, entry, 'request_start', 'pending', 'pending')

    // --- Retry loop ---
    const retryConfig = {
      maxRetries: opts.retry?.maxRetries ?? 0,
      baseDelayMs: opts.retry?.baseDelayMs ?? 300,
      backoffFactor: opts.retry?.backoffFactor ?? 2,
      retryOnStatuses: opts.retry?.retryOnStatuses ?? [429, 500, 502, 503, 504],
    }

    let lastError: NetError | undefined
    let lastAttempt = 0
    let responseData: T | undefined
    let httpStatus: number | undefined

    for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
      lastAttempt = attempt

      if (entry.cancelled) {
        lastError = this.buildCancelError(entry)
        break
      }

      // Backoff delay (skip first attempt)
      if (attempt > 0) {
        const delay = retryConfig.baseDelayMs * Math.pow(retryConfig.backoffFactor, attempt - 1)
        this.trace(opts, entry, 'request_retry', 'pending', 'pending', { retryCount: attempt })
        await sleep(delay)
        if (entry.cancelled) {
          lastError = this.buildCancelError(entry)
          break
        }
      }

      try {
        if (useMock) {
          const result = await mockFetch<T>(opts.method, opts.url, opts.data, opts.params as Record<string, string>)
          httpStatus = result.status
          if (!result.ok) {
            throw new NetHttpError(`Mock ${result.status}`, result.status, { requestId, requestKey })
          }
          responseData = result.data
        } else {
          const result = await fetchRequest<T>({
            method: opts.method,
            url: opts.url,
            headers: opts.headers,
            body: opts.data,
            params: opts.params as Record<string, unknown>,
            timeoutMs: opts.timeoutMs,
            signal: entry.controller.signal,
          })
          httpStatus = result.status
          responseData = result.data
        }

        // Success — check stale
        if (policy === 'takeLatest' && this.latestByKey.get(requestKey) !== requestId) {
          lastError = new NetStaleDiscardedError(undefined, { requestId, requestKey })
          break
        }

        // Check late response
        if (entry.cancelled) {
          if (opts.allowLateResponse) {
            this.trace(opts, entry, 'late_response_discarded', 'late_discarded', 'late_discarded')
            lastError = new NetLateDiscardedError(undefined, { requestId, requestKey })
          } else {
            lastError = this.buildCancelError(entry)
          }
          break
        }

        lastError = undefined
        break
      } catch (err) {
        const netErr = normalizeToNetError(err, requestId, requestKey)

        // Timeout detection from AbortError
        if (netErr.code === 'canceled' && entry.cancelled && entry.cancelReason === 'timeout') {
          lastError = new NetTimeoutError(undefined, { requestId, requestKey })
        } else {
          lastError = netErr
        }

        if (entry.cancelled) break

        if (attempt < retryConfig.maxRetries && isRetryableError(lastError, retryConfig.retryOnStatuses)) {
          continue
        }
        break
      }
    }

    // --- End ---
    if (tracking !== 'none') {
      endLoading(tracking === 'scope' ? opts.scopeId : undefined)
    }

    recordNetworkResult(!lastError)
    this.cleanup(entry, policy)

    const finalState = resolveFinalStateFromError(lastError)
    this.trace(opts, entry, 'request_end', this.traceStatus(finalState), finalState, {
      retryCount: lastAttempt,
      httpStatus,
      errorCode: lastError?.code,
      errorMessage: lastError?.message,
    })

    return this.buildResult<T>(entry, responseData, lastError, lastAttempt, httpStatus)
  }

  // -------------------------------------------------------------------------
  // Streaming
  // -------------------------------------------------------------------------

  stream(opts: NetRequest): NetStreamHandle {
    const requestId = createId('req')
    const requestKey = resolveRequestKey(opts, requestId)
    const policy = resolvePolicy(opts)
    const controller = new AbortController()
    const useMock = opts.mock ?? (this.mode === 'mock')

    const entry: InflightEntry = {
      requestId,
      requestKey,
      controller,
      cancelled: false,
      startedAt: Date.now(),
    }
    this.inflight.set(requestId, entry)

    // Policy: takeLatest
    if (policy === 'takeLatest') {
      const prevId = this.latestByKey.get(requestKey)
      if (prevId) {
        const prev = this.inflight.get(prevId)
        if (prev && !prev.cancelled) this.cancelEntry(prev, 'latest_replaced')
      }
      this.latestByKey.set(requestKey, requestId)
    }

    let chunkHandler: ((chunk: NetStreamChunk) => void) | null = null
    let doneHandler: (() => void) | null = null
    let errorHandler: ((error: NetError) => void) | null = null

    const handle: NetStreamHandle = {
      requestId,
      requestKey,
      cancel: () => this.cancelEntry(entry, 'user'),
      onChunk: (fn) => { chunkHandler = fn },
      onDone: (fn) => { doneHandler = fn },
      onError: (fn) => { errorHandler = fn },
    }

    // Fire-and-forget async run
    const run = async () => {
      const tracking = resolveTrackLoading(opts)
      if (tracking !== 'none') startLoading(tracking === 'scope' ? opts.scopeId : undefined)

      this.trace(opts, entry, 'request_start', 'pending', 'pending', { mode: 'stream' })

      try {
        if (useMock) {
          let chunkIndex = 0
          await mockStreamFetch(opts.url, opts.params as Record<string, string>, (text) => {
            if (entry.cancelled) return
            const chunk: NetStreamChunk = { index: chunkIndex++, text }
            this.trace(opts, entry, 'stream_chunk', 'pending', 'pending', { mode: 'stream', chunkIndex: chunk.index })
            chunkHandler?.(chunk)
          })
        } else {
          // Real fetch streaming — reuse shared URL/header/body builder
          const prepared = await buildRequestInit({
            method: opts.method,
            url: opts.url,
            headers: opts.headers,
            body: opts.data,
            params: opts.params,
          })

          // Stream timeout
          const cfg = getConfig()
          const timeoutMs = opts.timeoutMs ?? cfg.defaultTimeoutMs
          let streamTimeoutId: ReturnType<typeof setTimeout> | undefined
          if (timeoutMs) {
            streamTimeoutId = setTimeout(() => {
              entry.cancelReason = 'timeout'
              controller.abort()
            }, timeoutMs)
          }

          const fetchInit: RequestInit = {
            method: opts.method,
            headers: prepared.headers,
            signal: controller.signal,
          }
          if (prepared.body !== undefined) {
            fetchInit.body = prepared.body
          }

          let response: Response
          try {
            response = await fetch(prepared.url, fetchInit)
          } finally {
            if (streamTimeoutId) clearTimeout(streamTimeoutId)
          }
          if (!response.ok) {
            throw new NetHttpError(response.statusText, response.status, { requestId, requestKey })
          }

          const reader = response.body?.getReader()
          if (!reader) throw new Error('No readable stream')

          const decoder = new TextDecoder()
          let chunkIndex = 0

          while (true) {
            if (entry.cancelled) break
            const { done, value } = await reader.read()
            if (done) break

            const text = decoder.decode(value, { stream: true })
            const chunk: NetStreamChunk = { index: chunkIndex++, text, done: false }
            this.trace(opts, entry, 'stream_chunk', 'pending', 'pending', { mode: 'stream', chunkIndex: chunk.index })
            chunkHandler?.(chunk)
          }
        }

        if (!entry.cancelled) {
          chunkHandler?.({ index: -1, text: '', done: true })
          doneHandler?.()
          this.trace(opts, entry, 'request_end', 'ok', 'ok', { mode: 'stream' })
          recordNetworkResult(true)
        } else {
          this.trace(opts, entry, 'request_end', 'canceled', 'canceled', { mode: 'stream', cancelReason: entry.cancelReason })
        }
      } catch (err) {
        const netErr = normalizeToNetError(err, requestId, requestKey)
        errorHandler?.(netErr)
        const fs = resolveFinalStateFromError(netErr)
        this.trace(opts, entry, 'request_end', this.traceStatus(fs), fs, {
          mode: 'stream',
          errorCode: netErr.code,
          errorMessage: netErr.message,
        })
        recordNetworkResult(false)
      } finally {
        if (tracking !== 'none') endLoading(tracking === 'scope' ? opts.scopeId : undefined)
        this.cleanup(entry, policy)
      }
    }

    // Defer to allow onChunk/onDone/onError to be registered
    Promise.resolve().then(run)

    return handle
  }

  // -------------------------------------------------------------------------
  // Cancel
  // -------------------------------------------------------------------------

  cancel(target: string): boolean {
    // Try by requestId first
    const byId = this.inflight.get(target)
    if (byId) {
      this.cancelEntry(byId, 'user')
      return true
    }
    // Try by requestKey
    for (const entry of this.inflight.values()) {
      if (entry.requestKey === target && !entry.cancelled) {
        this.cancelEntry(entry, 'user')
        return true
      }
    }
    return false
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private cancelEntry(entry: InflightEntry, reason: CancelReason): void {
    if (entry.cancelled) return
    entry.cancelled = true
    entry.cancelReason = reason
    entry.controller.abort()
  }

  private buildCancelError(entry: InflightEntry): NetError {
    if (entry.cancelReason === 'latest_replaced') {
      return new NetStaleDiscardedError(undefined, { requestId: entry.requestId, requestKey: entry.requestKey })
    }
    if (entry.cancelReason === 'timeout') {
      return new NetTimeoutError(undefined, { requestId: entry.requestId, requestKey: entry.requestKey })
    }
    return new NetCanceledError(undefined, {
      requestId: entry.requestId,
      requestKey: entry.requestKey,
      cancelReason: entry.cancelReason,
    })
  }

  private buildResult<T>(
    entry: InflightEntry,
    data: T | undefined,
    error: NetError | undefined,
    retryCount: number,
    httpStatus?: number,
  ): NetResult<T> {
    return {
      ok: !error,
      requestId: entry.requestId,
      requestKey: entry.requestKey,
      status: httpStatus,
      data,
      error,
      durationMs: Date.now() - entry.startedAt,
      retryCount,
      finalState: resolveFinalStateFromError(error),
    }
  }

  private cleanup(entry: InflightEntry, policy: NetPolicy): void {
    this.inflight.delete(entry.requestId)

    if (policy === 'takeLatest' && this.latestByKey.get(entry.requestKey) === entry.requestId) {
      this.latestByKey.delete(entry.requestKey)
    }
    if (policy === 'dedupe') {
      this.dedupeByKey.delete(entry.requestKey)
    }
    if (policy === 'serial') {
      this.releaseSerialSlot(entry.requestKey)
    }
  }

  // --- Serial queue ---

  private waitForSerialSlot(key: string): Promise<void> {
    const queue = this.serialQueues.get(key)
    if (!queue || queue.length === 0) {
      this.serialQueues.set(key, [])
      return Promise.resolve()
    }
    return new Promise<void>(resolve => { queue.push(resolve) })
  }

  private releaseSerialSlot(key: string): void {
    const queue = this.serialQueues.get(key)
    if (!queue) return
    const next = queue.shift()
    if (next) next()
    else this.serialQueues.delete(key)
  }

  // --- Trace helpers ---

  private trace(
    opts: NetRequest,
    entry: InflightEntry,
    eventType: NetTraceEventType,
    status: NetTraceEvent['status'],
    finalState: NetFinalState | 'missing',
    extra?: Partial<NetTraceEvent>,
  ): void {
    if (!this.isDev) return
    pushNetTrace({
      eventType,
      ts: new Date().toISOString(),
      caseName: opts.caseName,
      requestId: entry.requestId,
      requestKey: entry.requestKey,
      groupKey: opts.groupKey,
      policy: resolvePolicy(opts),
      mode: extra?.mode ?? 'rest',
      env: (opts.mock ?? (this.mode === 'mock')) ? 'mock' : 'real',
      status,
      finalState,
      durationMs: Date.now() - entry.startedAt,
      ...extra,
    })
  }

  private traceStatus(fs: NetFinalState): NetTraceEvent['status'] {
    if (fs === 'ok') return 'ok'
    if (fs === 'canceled') return 'canceled'
    if (fs === 'stale_discarded') return 'stale'
    if (fs === 'late_discarded') return 'late_discarded'
    return 'error'
  }
}
