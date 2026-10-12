// Web Push (RFC 8030) with message encryption (RFC 8291, aes128gcm) and VAPID
// (RFC 8292), on WebCrypto only. Keys are base64url: the VAPID public key as
// the raw 65-byte P-256 point the browser's applicationServerKey takes, the
// private key as its 32-byte scalar (the JWK "d").

export interface PushTarget {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

export interface Vapid {
  publicKey: string
  privateKey: string
  /** A mailto: or https: contact for the push services. */
  subject: string
}

export function b64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

const text = (s: string): Uint8Array<ArrayBuffer> => new Uint8Array(new TextEncoder().encode(s))

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0))
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.byteLength
  }
  return out
}

/** The P-256 private key of a raw public point and its scalar, for ECDSA or ECDH. */
export function importPrivateKey(publicRaw: Uint8Array, d: string, algorithm: 'ECDSA' | 'ECDH'): Promise<CryptoKey> {
  const jwk: JsonWebKey = {
    kty: 'EC',
    crv: 'P-256',
    x: b64url(publicRaw.slice(1, 33)),
    y: b64url(publicRaw.slice(33, 65)),
    d,
    ext: true,
  }
  return crypto.subtle.importKey('jwk', jwk, { name: algorithm, namedCurve: 'P-256' }, false, algorithm === 'ECDSA' ? ['sign'] : ['deriveBits'])
}

async function hkdf(salt: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, bytes: number) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8))
}

/**
 * Encrypts a message for one subscription: a single aes128gcm record. `fixed`
 * (the sender's key pair and salt) is for tests; they are random otherwise.
 */
export async function encrypt(
  plaintext: Uint8Array,
  target: PushTarget,
  fixed?: { publicKey: Uint8Array; privateKey: CryptoKey; salt: Uint8Array<ArrayBuffer> },
): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = fromB64url(target.keys.p256dh)
  const authSecret = fromB64url(target.keys.auth)
  let asPublic: Uint8Array<ArrayBuffer>
  let asPrivate: CryptoKey
  if (fixed) {
    asPublic = new Uint8Array(fixed.publicKey)
    asPrivate = fixed.privateKey
  } else {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair
    asPublic = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer)
    asPrivate = pair.privateKey
  }
  const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16))

  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  // Workers' types spell the "public" member $public; the runtime takes "public", as the Web Crypto spec does.
  const ecdh = { name: 'ECDH', public: uaKey } as unknown as Parameters<SubtleCrypto['deriveBits']>[0]
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits(ecdh, asPrivate, 256))
  const ikm = await hkdf(authSecret, ecdhSecret, concat(text('WebPush: info\0'), uaPublic, asPublic), 32)
  const cek = await hkdf(salt, ikm, text('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, text('Content-Encoding: nonce\0'), 12)

  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  // One record, so the padding delimiter is 2 (last record) with no padding.
  const record = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(plaintext, new Uint8Array([2]))))

  // Header: salt, record size (uint32), key id length and key id (our public key).
  const header = new Uint8Array(16 + 4 + 1 + asPublic.byteLength)
  header.set(salt, 0)
  new DataView(header.buffer).setUint32(16, 4096)
  header[20] = asPublic.byteLength
  header.set(asPublic, 21)
  return concat(header, record)
}

/** The Authorization header that identifies this server to the push service. */
export async function vapidAuthorization(endpoint: string, vapid: Vapid, now = Date.now()): Promise<string> {
  const enc = (o: object) => b64url(text(JSON.stringify(o)))
  const unsigned = `${enc({ typ: 'JWT', alg: 'ES256' })}.${enc({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now / 1000) + 12 * 3600,
    sub: vapid.subject,
  })}`
  const key = await importPrivateKey(fromB64url(vapid.publicKey), vapid.privateKey, 'ECDSA')
  // WebCrypto signs in the raw r || s form JWS expects.
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, text(unsigned)))
  return `vapid t=${unsigned}.${b64url(sig)}, k=${vapid.publicKey}`
}

export interface PushOptions {
  /** Seconds the push service keeps the message for an offline device. */
  ttl: number
  /** A newer message with the same topic replaces one not delivered yet. */
  topic?: string
}

/** Sends one message. Resolves to the push service's status: 201 when accepted, 404 / 410 when the subscription is gone. */
export async function sendPush(target: PushTarget, payload: unknown, vapid: Vapid, opts: PushOptions): Promise<number> {
  const body = await encrypt(text(JSON.stringify(payload)), target)
  const headers: Record<string, string> = {
    Authorization: await vapidAuthorization(target.endpoint, vapid),
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    TTL: String(opts.ttl),
    Urgency: 'normal',
  }
  if (opts.topic) headers.Topic = opts.topic
  const res = await fetch(target.endpoint, { method: 'POST', headers, body })
  return res.status
}
