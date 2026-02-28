import { describe, it, expect, beforeEach } from 'vitest'
import {
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
} from '../src/netStore'

describe('netStore', () => {
  beforeEach(() => {
    resetNetStore()
  })

  describe('loading', () => {
    it('should track global loading count', () => {
      expect(getSnapshot().globalLoadingCount).toBe(0)
      startLoading()
      expect(getSnapshot().globalLoadingCount).toBe(1)
      startLoading()
      expect(getSnapshot().globalLoadingCount).toBe(2)
      endLoading()
      expect(getSnapshot().globalLoadingCount).toBe(1)
      endLoading()
      expect(getSnapshot().globalLoadingCount).toBe(0)
    })

    it('should not go below zero', () => {
      endLoading()
      expect(getSnapshot().globalLoadingCount).toBe(0)
    })

    it('should track scope loading', () => {
      startLoading('scope-a')
      expect(getScopeLoadingCount('scope-a')).toBe(1)
      expect(getSnapshot().globalLoadingCount).toBe(1)

      startLoading('scope-b')
      expect(getScopeLoadingCount('scope-b')).toBe(1)
      expect(getSnapshot().globalLoadingCount).toBe(2)

      endLoading('scope-a')
      expect(getScopeLoadingCount('scope-a')).toBe(0)
      expect(getSnapshot().globalLoadingCount).toBe(1)
    })
  })

  describe('offline', () => {
    it('should toggle offline state', () => {
      expect(getSnapshot().isOffline).toBe(false)
      setOffline(true)
      expect(getSnapshot().isOffline).toBe(true)
      setOffline(false)
      expect(getSnapshot().isOffline).toBe(false)
    })
  })

  describe('flakiness', () => {
    it('should detect flaky network', () => {
      // Need at least 6 samples with >= 50% failure
      for (let i = 0; i < 6; i++) {
        recordNetworkResult(false)
      }
      expect(getSnapshot().isFlaky).toBe(true)
    })

    it('should not flag as flaky with all successes', () => {
      for (let i = 0; i < 10; i++) {
        recordNetworkResult(true)
      }
      expect(getSnapshot().isFlaky).toBe(false)
    })
  })

  describe('notice', () => {
    it('should push and clear notice', () => {
      expect(getSnapshot().lastNotice).toBeNull()
      pushNetNotice({ type: 'error', messageKey: 'net.timeout' })
      expect(getSnapshot().lastNotice).not.toBeNull()
      expect(getSnapshot().lastNotice?.messageKey).toBe('net.timeout')

      clearNetNotice()
      expect(getSnapshot().lastNotice).toBeNull()
    })
  })

  describe('subscribe', () => {
    it('should call listener on state change', () => {
      let callCount = 0
      const unsub = subscribe(() => { callCount++ })

      startLoading()
      expect(callCount).toBe(1)

      endLoading()
      expect(callCount).toBe(2)

      unsub()
      startLoading()
      expect(callCount).toBe(2) // unsubscribed
    })
  })

  describe('reset', () => {
    it('should reset all state', () => {
      startLoading()
      startLoading('scope-x')
      setOffline(true)
      pushNetNotice({ type: 'warn', message: 'test' })

      resetNetStore()

      const snap = getSnapshot()
      expect(snap.globalLoadingCount).toBe(0)
      expect(snap.isOffline).toBe(false)
      expect(snap.lastNotice).toBeNull()
      expect(getScopeLoadingCount('scope-x')).toBe(0)
    })
  })
})
