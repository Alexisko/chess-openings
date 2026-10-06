import { describe, expect, it } from 'vitest'
import { b64url, encrypt, fromB64url, importPrivateKey, vapidAuthorization } from './webpush'

describe('encrypt', () => {
  it('matches the example of RFC 8291, appendix A', async () => {
    const asPublic = fromB64url('BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8')
    const body = await encrypt(
      new TextEncoder().encode('When I grow up, I want to be a watermelon'),
      {
        endpoint: 'https://push.example.net/push/JzLQ3raZJfFBR0aqvOMsLrt54w4rJUsV',
        keys: {
          p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
          auth: 'BTBZMqHH6r4Tts7J_aSIgg',
        },
      },
      {
        publicKey: asPublic,
        privateKey: await importPrivateKey(asPublic, 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', 'ECDH'),
        salt: fromB64url('DGv6ra1nlYgDCS1FRnbzlw'),
      },
    )
    expect(b64url(body)).toBe(
      'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
    )
  })
})

describe('vapidAuthorization', () => {
  it('signs a JWT for the push service that the public key verifies', async () => {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
    const publicRaw = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer)
    const { d } = await crypto.subtle.exportKey('jwk', pair.privateKey)
    const vapid = { publicKey: b64url(publicRaw), privateKey: d!, subject: 'mailto:me@example.com' }

    const auth = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', vapid, 1_700_000_000_000)
    const [, jwt, k] = auth.match(/^vapid t=([^,]+), k=(.+)$/)!
    expect(k).toBe(vapid.publicKey)
    const [header, payload, sig] = jwt.split('.')
    expect(JSON.parse(new TextDecoder().decode(fromB64url(payload)))).toEqual({
      aud: 'https://fcm.googleapis.com',
      exp: 1_700_000_000 + 12 * 3600,
      sub: 'mailto:me@example.com',
    })
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      pair.publicKey,
      fromB64url(sig),
      new TextEncoder().encode(`${header}.${payload}`),
    )
    expect(ok).toBe(true)
  })
})
