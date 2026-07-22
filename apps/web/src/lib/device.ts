// A stable, opaque first-party device id kept in localStorage. Not PII; used as
// one signal for bonus abuse prevention. Resets if the user clears storage.
const KEY = 'wb_device_id'

export function getDeviceId(): string {
  if (typeof window === 'undefined') return ''
  try {
    let id = window.localStorage.getItem(KEY)
    if (!id) {
      id = crypto.randomUUID()
      window.localStorage.setItem(KEY, id)
    }
    return id
  } catch {
    return ''
  }
}
