/**
 * Id generation.
 *
 * `crypto.randomUUID` needs a secure context, which covers localhost and any
 * https deployment, but not a plain-http LAN address — handy when testing the
 * PWA on a phone against a dev server. The fallback covers that case.
 */
export function newId(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // `getRandomValues` is available even outside a secure context.
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  // RFC 4122 version 4 bits.
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
