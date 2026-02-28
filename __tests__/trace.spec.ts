import { describe, it, expect, beforeEach } from 'vitest'
import {
  startNetTraceRun,
  pushNetTrace,
  getNetTraceSnapshot,
  clearNetTrace,
  exportNetTracePayload,
  exportNetTraceAndClear,
} from '../src/trace'
import type { NetTraceEvent } from '../src/types'

function makeEvent(overrides: Partial<NetTraceEvent> = {}): NetTraceEvent {
  return {
    eventType: 'request_start',
    ts: new Date().toISOString(),
    requestId: 'req_test',
    policy: 'parallel',
    mode: 'rest',
    env: 'mock',
    status: 'pending',
    finalState: 'pending',
    durationMs: 0,
    ...overrides,
  }
}

describe('trace', () => {
  beforeEach(() => {
    clearNetTrace()
  })

  it('should push and retrieve events', () => {
    pushNetTrace(makeEvent({ requestId: 'req_1' }))
    pushNetTrace(makeEvent({ requestId: 'req_2' }))
    const snapshot = getNetTraceSnapshot()
    expect(snapshot).toHaveLength(2)
    expect(snapshot[0].requestId).toBe('req_1')
  })

  it('should clear trace buffer', () => {
    pushNetTrace(makeEvent())
    clearNetTrace()
    expect(getNetTraceSnapshot()).toHaveLength(0)
  })

  it('should enforce max buffer size via shift', () => {
    for (let i = 0; i < 2005; i++) {
      pushNetTrace(makeEvent({ requestId: `req_${i}` }))
    }
    const snapshot = getNetTraceSnapshot()
    expect(snapshot.length).toBeLessThanOrEqual(2000)
    // The oldest events should have been removed
    expect(snapshot[0].requestId).toBe('req_5')
  })

  it('startNetTraceRun should return meta and clear buffer', () => {
    pushNetTrace(makeEvent())
    const meta = startNetTraceRun('test run', 'mock')
    expect(meta.runId).toMatch(/^net_/)
    expect(meta.note).toBe('test run')
    expect(meta.env).toBe('mock')
    expect(getNetTraceSnapshot()).toHaveLength(0)
  })

  it('exportNetTracePayload should include summary', () => {
    pushNetTrace(makeEvent({ eventType: 'request_end', finalState: 'ok' }))
    pushNetTrace(makeEvent({ eventType: 'request_end', finalState: 'error' }))
    pushNetTrace(makeEvent({ eventType: 'request_end', finalState: 'ok' }))

    const payload = exportNetTracePayload({ appVersion: '1.0.0' })
    expect(payload.traceMeta.appVersion).toBe('1.0.0')
    expect(payload.summary.totalEvents).toBe(3)
    expect(payload.summary.totals['ok']).toBe(2)
    expect(payload.summary.totals['error']).toBe(1)
  })

  it('exportNetTraceAndClear should clear after export', () => {
    pushNetTrace(makeEvent())
    pushNetTrace(makeEvent())
    const payload = exportNetTraceAndClear()
    expect(payload.events).toHaveLength(2)
    expect(getNetTraceSnapshot()).toHaveLength(0)
  })
})
