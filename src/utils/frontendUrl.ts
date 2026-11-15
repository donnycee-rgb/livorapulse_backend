/**
 * The web app's address, from FRONTEND_URL, without a trailing slash, so
 * `${frontendUrl()}/dashboard` never becomes "https://site//dashboard"
 * (which the app shows as "Page not found").
 */
export function frontendUrl(): string {
  return (process.env.FRONTEND_URL || 'http://localhost:5173').trim().replace(/\/+$/, '')
}
