// ---------------------------------------------------------------------------
// @moyin/net-client — Framework-agnostic loading state management
// ---------------------------------------------------------------------------
// Uses an EventEmitter pattern instead of Vue refs / React state.
// Consumers wrap with useSyncExternalStore (React) or watchEffect (Vue).
// ---------------------------------------------------------------------------

import type { NetNotice, NetStoreSnapshot } from './types'

type Listener = () => void

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

let globalLoadingCount = 0
const scopeLoading: Record<string, number> = {}
let isOffline = false
let isFlaky = false
let lastNotice: NetNotice | null = null

// Network quality tracking
const RECENT_WINDOW_MS = 60_000
const FLAP_SAMPLE_MIN = 6
const FLAP_FAIL_RATE = 0.5
const networkResults: { ts: number; ok: boolean }[] = []

// Listeners
const listeners = new Set<Listener>()

// Cached snapshot — only rebuild on emit() to avoid infinite re-renders in React useSyncExternalStore
let cachedSnapshot: NetStoreSnapshot | null = null

function emit(): void {
  cachedSnapshot = null
  for (const fn of listeners) fn()
}

// ---------------------------------------------------------------------------
// Public API — subscribe (for useSyncExternalStore / watchEffect)
// ---------------------------------------------------------------------------

export function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function getSnapshot(): NetStoreSnapshot {
  if (!cachedSnapshot) {
    cachedSnapshot = {
      globalLoadingCount,
      scopeLoading: { ...scopeLoading },
      isOffline,
      isFlaky,
      lastNotice,
    }
  }
  return cachedSnapshot
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export function startLoading(scopeId?: string): void {
  globalLoadingCount++
  if (scopeId) {
    scopeLoading[scopeId] = (scopeLoading[scopeId] ?? 0) + 1
  }
  emit()
}

export function endLoading(scopeId?: string): void {
  globalLoadingCount = Math.max(0, globalLoadingCount - 1)
  if (scopeId && scopeLoading[scopeId] != null) {
    scopeLoading[scopeId] = Math.max(0, scopeLoading[scopeId] - 1)
    if (scopeLoading[scopeId] === 0) delete scopeLoading[scopeId]
  }
  emit()
}

export function getScopeLoadingCount(scopeId: string): number {
  return scopeLoading[scopeId] ?? 0
}

// ---------------------------------------------------------------------------
// Offline
// ---------------------------------------------------------------------------

export function setOffline(flag: boolean): void {
  if (isOffline !== flag) {
    isOffline = flag
    emit()
  }
}

// ---------------------------------------------------------------------------
// Network quality
// ---------------------------------------------------------------------------

export function recordNetworkResult(ok: boolean): void {
  const now = Date.now()
  networkResults.push({ ts: now, ok })

  // Prune old entries
  const cutoff = now - RECENT_WINDOW_MS
  while (networkResults.length > 0 && networkResults[0].ts < cutoff) {
    networkResults.shift()
  }

  // Evaluate flakiness
  if (networkResults.length >= FLAP_SAMPLE_MIN) {
    const failCount = networkResults.filter(r => !r.ok).length
    const newFlaky = failCount / networkResults.length >= FLAP_FAIL_RATE
    if (isFlaky !== newFlaky) {
      isFlaky = newFlaky
      emit()
    }
  } else if (isFlaky) {
    isFlaky = false
    emit()
  }
}

// ---------------------------------------------------------------------------
// Notice
// ---------------------------------------------------------------------------

export function pushNetNotice(notice: Omit<NetNotice, 'ts'>): void {
  lastNotice = { ...notice, ts: new Date().toISOString() }
  emit()
}

export function clearNetNotice(): void {
  if (lastNotice !== null) {
    lastNotice = null
    emit()
  }
}

// ---------------------------------------------------------------------------
// Reset (for tests)
// ---------------------------------------------------------------------------

export function resetNetStore(): void {
  globalLoadingCount = 0
  for (const k of Object.keys(scopeLoading)) delete scopeLoading[k]
  isOffline = false
  isFlaky = false
  lastNotice = null
  networkResults.length = 0
  emit()
}
