// ---------------------------------------------------------------------------
// @moyin/net-client — i18n messages (zh-TW / zh-CN / zh-HK / en / ja)
// ---------------------------------------------------------------------------

const messages: Record<string, Record<string, string>> = {
  'zh-TW': {
    'net.offline': '網絡不可用，請檢查連線',
    'net.timeout': '網絡超時，請稍後再試',
    'net.canceled': '請求已取消',
    'net.stale': '請求已被替換',
    'net.http_error': '服務器回應錯誤',
    'net.network_error': '網絡錯誤',
    'net.unknown': '未知錯誤',
    'net.retry': '請求重試中',
    'net.late_discarded': '晚到回包已丟棄',
  },
  'zh-CN': {
    'net.offline': '网络不可用，请检查连线',
    'net.timeout': '网络超时，请稍后再试',
    'net.canceled': '请求已取消',
    'net.stale': '请求已被替换',
    'net.http_error': '服务器响应错误',
    'net.network_error': '网络错误',
    'net.unknown': '未知错误',
    'net.retry': '请求重试中',
    'net.late_discarded': '晚到回包已丢弃',
  },
  'zh-HK': {
    'net.offline': '網絡不可用，請檢查連線',
    'net.timeout': '網絡超時，請稍後再試',
    'net.canceled': '請求已取消',
    'net.stale': '請求已被替換',
    'net.http_error': '伺服器回應錯誤',
    'net.network_error': '網絡錯誤',
    'net.unknown': '未知錯誤',
    'net.retry': '請求重試中',
    'net.late_discarded': '晚到回包已丟棄',
  },
  'en': {
    'net.offline': 'Network unavailable, please check your connection',
    'net.timeout': 'Request timed out, please try again later',
    'net.canceled': 'Request canceled',
    'net.stale': 'Request replaced by a newer request',
    'net.http_error': 'Server responded with an error',
    'net.network_error': 'Network error',
    'net.unknown': 'Unknown error',
    'net.retry': 'Retrying request…',
    'net.late_discarded': 'Late response discarded',
  },
  'ja': {
    'net.offline': 'ネットワークに接続できません。接続を確認してください',
    'net.timeout': 'リクエストがタイムアウトしました。しばらくしてから再試行してください',
    'net.canceled': 'リクエストがキャンセルされました',
    'net.stale': 'リクエストは新しいリクエストに置き換えられました',
    'net.http_error': 'サーバーエラーが発生しました',
    'net.network_error': 'ネットワークエラー',
    'net.unknown': '不明なエラー',
    'net.retry': 'リクエストを再試行中…',
    'net.late_discarded': '遅延レスポンスは破棄されました',
  },
}

const DEFAULT_LOCALE = 'zh-TW'

export function resolveNetMessage(messageKey: string | undefined, locale?: string): string {
  if (!messageKey) return ''
  const lang = locale ?? DEFAULT_LOCALE
  const dict = messages[lang] ?? messages[DEFAULT_LOCALE]
  return dict[messageKey] ?? messageKey
}

export function listNetMessageKeys(locale?: string): string[] {
  const lang = locale ?? DEFAULT_LOCALE
  const dict = messages[lang] ?? messages[DEFAULT_LOCALE]
  return Object.keys(dict)
}
