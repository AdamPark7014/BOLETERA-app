export type OauthProvider = 'google' | 'microsoft';

const API_URL =
  process.env.NEXT_PUBLIC_ADMIN_API_URL || 'http://localhost:4000/api/v1';

export function resolveOauthProvider(value: string | null): OauthProvider {
  return value === 'microsoft' ? 'microsoft' : 'google';
}

/** Must match the redirect_uri used in /auth/oauth/:provider/start. */
export function oauthCallbackRedirectUri(provider: OauthProvider, origin: string): string {
  return `${origin}/login/oauth/callback?provider=${provider}`;
}

export function oauthStartUrl(provider: OauthProvider, origin: string): string {
  const redirect = oauthCallbackRedirectUri(provider, origin);
  return `${API_URL}/auth/oauth/${provider}/start?redirect_uri=${encodeURIComponent(redirect)}`;
}
