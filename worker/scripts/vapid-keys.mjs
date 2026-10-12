// Prints a new VAPID key pair for the daily reminders and the commands that
// store it as Worker secrets. Run once: `node scripts/vapid-keys.mjs`.
// Changing the keys later turns off reminders on every device until they are
// switched on again.

const b64url = (buf) => Buffer.from(buf).toString('base64url')

const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const publicKey = b64url(await crypto.subtle.exportKey('raw', pair.publicKey))
const { d } = await crypto.subtle.exportKey('jwk', pair.privateKey)

console.log(`VAPID_PUBLIC_KEY  ${publicKey}`)
console.log(`VAPID_PRIVATE_KEY ${d}`)
console.log(`
Store them (and a contact for the push services) as secrets:

  echo ${publicKey} | npx wrangler secret put VAPID_PUBLIC_KEY
  echo ${d} | npx wrangler secret put VAPID_PRIVATE_KEY
  echo mailto:you@example.com | npx wrangler secret put VAPID_SUBJECT
`)
