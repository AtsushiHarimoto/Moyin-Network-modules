// ---------------------------------------------------------------------------
// @moyin/net-client — Request lifecycle tracing
// ---------------------------------------------------------------------------

import type { NetEnvMode, NetFinalState, NetTraceEvent, NetTraceMeta } from './types'

// ---------------------------------------------------------------------------
// Internal buffer
// ---------------------------------------------------------------------------

const MAX_BUFFER_SIZE = 2000

let currentMeta: NetTraceMeta | null = null
const buffer: NetTraceEvent[] = []

function createId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function startNetTraceRun(note?: string, env?: NetEnvMode): NetTraceMeta {
  currentMeta = {
    runId: createId('net'),
    generatedAt: new Date().toISOString(),
    env,
    note,
  }
  buffer.length = 0
  return currentMeta
}

export function pushNetTrace(event: NetTraceEvent): void {
  if (buffer.length >= MAX_BUFFER_SIZE) {
    buffer.shift()
  }
  buffer.push(event)
}

export function getNetTraceSnapshot(): NetTraceEvent[] {
  return [...buffer]
}

export function clearNetTrace(): void {
  buffer.length = 0
}

// ---------------------------------------------------------------------------
// Export with summary and assertions
// ---------------------------------------------------------------------------

interface Mismatch {
  requestId: string
  expected: string
  actual: string
  detail: string
}

export function exportNetTracePayload(meta?: {
  appVersion?: string
  env?: NetEnvMode
  note?: string
}) {
  const traceMeta: NetTraceMeta = {
    runId: currentMeta?.runId ?? createId('net'),
    generatedAt: new Date().toISOString(),
    appVersion: meta?.appVersion,
    env: meta?.env ?? currentMeta?.env,
    note: meta?.note ?? currentMeta?.note,
  }

  // Summary: count final states
  const totals: Record<string, number> = {}
  for (const ev of buffer) {
    if (ev.eventType === 'request_end') {
      const state = ev.finalState as string
      totals[state] = (totals[state] ?? 0) + 1
    }
  }

  // Assertions: check late_response_discarded pairings
  const mismatches: Mismatch[] = []
  const lateEvents = buffer.filter(e => e.eventType === 'late_response_discarded')
  for (const le of lateEvents) {
    const end = buffer.find(
      e => e.eventType === 'request_end' && e.requestId === le.requestId,
    )
    if (!end) {
      mismatches.push({
        requestId: le.requestId,
        expected: 'request_end with late_discarded',
        actual: 'missing',
        detail: `late_response_discarded without corresponding request_end`,
      })
    } else if (end.finalState !== 'late_discarded') {
      mismatches.push({
        requestId: le.requestId,
        expected: 'late_discarded',
        actual: end.finalState as string,
        detail: `request_end finalState should be late_discarded`,
      })
    }
  }

  return {
    traceMeta,
    events: [...buffer],
    summary: {
      totalEvents: buffer.length,
      totals: totals as Record<NetFinalState, number>,
      assertions: { mismatches },
    },
  }
}

export function exportNetTraceAndClear(meta?: {
  appVersion?: string
  env?: NetEnvMode
  note?: string
}) {
  const payload = exportNetTracePayload(meta)
  buffer.length = 0
  return payload
}
