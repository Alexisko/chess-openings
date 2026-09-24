import { getSettings, setSetting } from '../../db/settings'

// "Login with Lichess" using OAuth 2 PKCE. Lichess accepts any client_id for
// public clients, so no app registration or secret is needed. No scopes are
// requested: the opening explorer only needs an authenticated token.

const LICHESS = 'https://lichess.org'
const CLIENT_ID = 'opening-trainer'
const STORAGE_KEY = 'lichess-oauth'

const BASE = import.meta.env.BASE_URL
const redirectUri = () => `${location.origin}${BASE}`

/** Current route relative to the app's base path (what the router navigates to). */
const currentRoute = () => `/${location.pathname.slice(BASE.length)}${location.search}`

function base64Url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  return btoa(String.fromCharCode(...arr))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function randomString(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)))
}

export async function startLogin() {
  const verifier = randomString()
  const state = randomString()
  const challenge = base64Url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ verifier, state, returnTo: currentRoute() }))
  } catch {
    throw new Error('Session storage is unavailable; paste a personal token in Settings instead.')
  }
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: redirectUri(),
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
  })
  location.assign(`${LICHESS}/oauth?${params}`)
}

/**
 * Completes the login if the current URL is an OAuth callback. Returns the
 * path to go back to, or null if this wasn't a callback.
 */
export async function completeLoginIfCallback(): Promise<string | null> {
  const url = new URL(location.href)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')
  if (!code && !error) return null

  let saved: { verifier: string; state: string; returnTo: string } | null = null
  try {
    saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null')
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    saved = null
  }
  history.replaceState(null, '', url.pathname)
  if (error) throw new Error(`Lichess login was cancelled (${error})`)
  if (!saved || saved.state !== state) throw new Error('Lichess login failed: state mismatch')

  const res = await fetch(`${LICHESS}/api/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: code!,
      code_verifier: saved.verifier,
      redirect_uri: redirectUri(),
      client_id: CLIENT_ID,
    }),
  })
  if (!res.ok) throw new Error(`Lichess login failed (${res.status})`)
  const { access_token } = (await res.json()) as { access_token: string }
  await saveToken(access_token)
  return saved.returnTo || '/'
}

/** Stores a token (from OAuth or pasted) after checking it and fetching the username. */
export async function saveToken(token: string) {
  const res = await fetch(`${LICHESS}/api/account`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error('That Lichess token was rejected')
  const account = (await res.json()) as { username: string }
  await setSetting('lichessToken', token)
  await setSetting('lichessUser', account.username)
}

export async function logout() {
  const { lichessToken } = await getSettings()
  if (lichessToken) {
    await fetch(`${LICHESS}/api/token`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${lichessToken}` },
    }).catch(() => undefined)
  }
  await setSetting('lichessToken', undefined)
  await setSetting('lichessUser', undefined)
}

export async function getToken(): Promise<string | undefined> {
  return (await getSettings()).lichessToken
}
