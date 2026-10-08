/**
 * idiCORE env inspection. Safe to import from tests — no undici / network.
 * Auth/search hosts decide test vs paid production. Auth itself does not
 * consume a search; only POST /search/MineralMap does.
 */

export const IDICORE_PROD_AUTH_HOST = 'login-api.idicore.com'
export const IDICORE_PROD_SEARCH_HOST = 'api.idicore.com'
export const IDICORE_TEST_AUTH_HOST = 'login-api-test.idicore.com'
export const IDICORE_TEST_SEARCH_HOST = 'api-test.idicore.com'

export type IdicoreEnvKind = 'test' | 'production' | 'mixed' | 'unknown' | 'unset'

export type IdicoreWiringReport = {
  enabled: boolean
  environment: IdicoreEnvKind
  authHost: string | null
  searchHost: string | null
  searchPath: string | null
  clientIdSet: boolean
  clientIdLooksTest: boolean | null
  clientSecretSet: boolean
  proxySet: boolean
  glba: string
  dppa: string
  issues: string[]
  readyForPaidQuota: boolean
}

function hostOf(url: string): string | null {
  const trimmed = url.trim()
  if (!trimmed) return null
  try {
    return new URL(trimmed).host.toLowerCase()
  } catch {
    return 'invalid-url'
  }
}

function pathOf(url: string): string | null {
  const trimmed = url.trim()
  if (!trimmed) return null
  try {
    return new URL(trimmed).pathname
  } catch {
    return null
  }
}

export function classifyIdicoreHost(host: string | null): IdicoreEnvKind {
  if (!host) return 'unset'
  if (host === 'invalid-url') return 'unknown'
  if (host.includes('-test.')) return 'test'
  if (host === IDICORE_PROD_AUTH_HOST || host === IDICORE_PROD_SEARCH_HOST) {
    return 'production'
  }
  if (host.endsWith('.idicore.com')) return 'unknown'
  return 'unknown'
}

export function clientIdLooksLikeTest(clientId: string): boolean {
  const id = clientId.trim().toLowerCase()
  if (!id) return false
  return id.includes('_test') || id.endsWith('.test') || id.includes('-test')
}

export function inspectIdicoreEnv(
  env: Record<string, string | undefined> = process.env,
): IdicoreWiringReport {
  const authUrl = env.IDICORE_AUTH_URL?.trim() || ''
  const searchUrl =
    env.IDICORE_SEARCH_URL?.trim() || env.IDICORE_API_URL?.trim() || ''
  const clientId = env.IDICORE_CLIENT_ID?.trim() || ''
  const clientSecret = env.IDICORE_CLIENT_SECRET?.trim() || ''
  const proxy =
    env.IDICORE_PROXY_URL?.trim() || env.SKIPTRACE_PROXY_URL?.trim() || ''
  const glba = env.IDICORE_GLBA?.trim() || 'otheruse'
  const dppa = env.IDICORE_DPPA?.trim() || 'none'

  const authHost = hostOf(authUrl)
  const searchHost = hostOf(searchUrl)
  const searchPath = pathOf(searchUrl)
  const authKind = classifyIdicoreHost(authHost)
  const searchKind = classifyIdicoreHost(searchHost)

  let environment: IdicoreEnvKind
  if (authKind === 'unset' && searchKind === 'unset') environment = 'unset'
  else if (authKind === 'test' && searchKind === 'test') environment = 'test'
  else if (authKind === 'production' && searchKind === 'production') {
    environment = 'production'
  } else if (authKind === 'unset' || searchKind === 'unset') environment = 'unknown'
  else if (authKind !== searchKind) environment = 'mixed'
  else environment = authKind

  const clientIdSet = Boolean(clientId)
  const clientSecretSet = Boolean(clientSecret)
  const proxySet = Boolean(proxy)
  const looksTest = clientIdSet ? clientIdLooksLikeTest(clientId) : null
  const enabled = Boolean(searchUrl)

  const issues: string[] = []
  if (!authUrl) issues.push('IDICORE_AUTH_URL is unset.')
  if (!searchUrl) issues.push('IDICORE_SEARCH_URL is unset.')
  if (!clientIdSet) issues.push('IDICORE_CLIENT_ID is unset.')
  if (!clientSecretSet) issues.push('IDICORE_CLIENT_SECRET is unset.')
  if (!proxySet) {
    issues.push(
      'IDICORE_PROXY_URL is unset. idiCORE allow-lists one static IP; Vercel must egress through QuotaGuard.',
    )
  }
  if (environment === 'test') {
    issues.push(
      'Auth/search still point at idiCORE test hosts (*-test*). The paid 12,500-search allotment is on production: login-api.idicore.com and api.idicore.com.',
    )
  }
  if (environment === 'mixed') {
    issues.push(
      'Auth and search hosts disagree (one test, one production). Both must be the paid production hosts.',
    )
  }
  if (looksTest) {
    issues.push(
      'IDICORE_CLIENT_ID still looks like the test API client (*_test*). Production credentials usually drop the _test suffix.',
    )
  }
  if (searchPath && !searchPath.toLowerCase().includes('mineralmap')) {
    issues.push(
      `Search path is ${searchPath}, expected /search/MineralMap for this account.`,
    )
  }

  const readyForPaidQuota =
    environment === 'production' &&
    enabled &&
    clientIdSet &&
    looksTest === false &&
    clientSecretSet &&
    proxySet &&
    issues.length === 0

  return {
    enabled,
    environment,
    authHost,
    searchHost,
    searchPath,
    clientIdSet,
    clientIdLooksTest: looksTest,
    clientSecretSet,
    proxySet,
    glba,
    dppa,
    issues,
    readyForPaidQuota,
  }
}
