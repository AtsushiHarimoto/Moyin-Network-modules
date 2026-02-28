import { describe, it, expect } from 'vitest'
import { resolveNetMessage, listNetMessageKeys } from '../src/netI18n'

describe('netI18n', () => {
  it('should resolve zh-TW message by key', () => {
    expect(resolveNetMessage('net.timeout', 'zh-TW')).toBe('網絡超時，請稍後再試')
  })

  it('should resolve en message by key', () => {
    expect(resolveNetMessage('net.timeout', 'en')).toBe('Request timed out, please try again later')
  })

  it('should resolve ja message by key', () => {
    expect(resolveNetMessage('net.canceled', 'ja')).toBe('リクエストがキャンセルされました')
  })

  it('should fallback to zh-TW for unknown locale', () => {
    expect(resolveNetMessage('net.offline', 'ko')).toBe('網絡不可用，請檢查連線')
  })

  it('should default to zh-TW when locale is omitted', () => {
    expect(resolveNetMessage('net.offline')).toBe('網絡不可用，請檢查連線')
  })

  it('should return empty string for undefined key', () => {
    expect(resolveNetMessage(undefined)).toBe('')
  })

  it('should return raw key for unknown message key', () => {
    expect(resolveNetMessage('net.nonexistent')).toBe('net.nonexistent')
  })

  it('listNetMessageKeys should return all keys for locale', () => {
    const keys = listNetMessageKeys('en')
    expect(keys).toContain('net.timeout')
    expect(keys).toContain('net.offline')
    expect(keys).toContain('net.canceled')
    expect(keys.length).toBe(9)
  })
})
