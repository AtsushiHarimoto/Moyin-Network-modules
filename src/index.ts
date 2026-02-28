// ---------------------------------------------------------------------------
// @moyin/net-client — Public API
// ---------------------------------------------------------------------------

// Types
export type {
  NetEnvMode,
  NetRequestMode,
  NetPolicy,
  NetTrackLoading,
  CancelReason,
  NetFinalState,
  HttpMethod,
  NetRetryOptions,
  NetRequest,
  NetResult,
  NetProgressEvent,
  NetStreamChunk,
  NetStreamHandle,
  NetTraceEventType,
  NetTraceEvent,
  NetTraceMeta,
  NetNotice,
  NetStoreSnapshot,
  MockRoute,
  MockStreamRoute,
  NetClientConfig,
} from './types'

// Errors
export {
  type NetErrorCode,
  NetError,
  NetCanceledError,
  NetStaleDiscardedError,
  NetTimeoutError,
  NetHttpError,
  NetOfflineError,
  NetUnknownError,
  NetLateDiscardedError,
  normalizeToNetError,
  isRetryableError,
  resolveFinalStateFromError,
} from './errors'

// RequestManager
export { RequestManager } from './requestManager'

// HTTP client (lightweight)
export { configure, getConfig, fetchRequest, buildRequestInit, get, post, put, patch, del } from './httpClient'
export type { FetchOptions, FetchResult, PreparedRequest } from './httpClient'

// Store (framework-agnostic)
export {
  subscribe,
  getSnapshot,
  startLoading,
  endLoading,
  getScopeLoadingCount,
  setOffline,
  recordNetworkResult,
  pushNetNotice,
  clearNetNotice,
  resetNetStore,
} from './netStore'

// Trace
export {
  startNetTraceRun,
  pushNetTrace,
  getNetTraceSnapshot,
  clearNetTrace,
  exportNetTracePayload,
  exportNetTraceAndClear,
} from './trace'

// i18n
export { resolveNetMessage, listNetMessageKeys } from './netI18n'

// Mock
export {
  registerMockRoute,
  registerMockStreamRoute,
  clearMockRoutes,
  findMockRoute,
  findMockStreamRoute,
  listMockRoutes,
  mockFetch,
  mockStream,
} from './mockTransport'
