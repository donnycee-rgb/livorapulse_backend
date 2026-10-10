// ─── Sending emails through EmailJS ─────────────────────────────────────────
// Emails are sent from the server with EmailJS's REST API, never from the
// browser: the browser must not see verification codes or reset tokens, or
// anyone could read them and skip the check.
//
// Set up in EmailJS (see .env.example):
//   EMAILJS_SERVICE_ID       the email service (e.g. your Gmail connection)
//   EMAILJS_PUBLIC_KEY       Account → API keys → Public key
//   EMAILJS_PRIVATE_KEY      Account → API keys → Private key
//   EMAILJS_TEMPLATE_VERIFY  template for the sign-up code
//   EMAILJS_TEMPLATE_RESET   template for the password reset link
// In EmailJS → Account → Security, allow API calls from non-browser apps.

const ENDPOINT = 'https://api.emailjs.com/api/v1.0/email/send'
const TIMEOUT_MS = 10_000

export type EmailKind = 'verify' | 'reset'

export interface EmailParams {
  to_email: string
  to_name: string
  /** For "verify": the 6-digit code */
  code?: string
  /** For "reset": the link to set a new password */
  reset_link?: string
  /** Minutes until the code or link stops working */
  expires_minutes: number
}

const TEMPLATE_ENV: Record<EmailKind, string> = {
  verify: 'EMAILJS_TEMPLATE_VERIFY',
  reset: 'EMAILJS_TEMPLATE_RESET',
}

export function emailConfigured(kind: EmailKind): boolean {
  return ['EMAILJS_SERVICE_ID', 'EMAILJS_PUBLIC_KEY', 'EMAILJS_PRIVATE_KEY', TEMPLATE_ENV[kind]].every((k) => !!process.env[k])
}

export class EmailError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'EmailError'
  }
}

/**
 * Sends one email. Without EmailJS settings, development builds print it to
 * the server console instead; production refuses, so a missing setting is
 * noticed rather than silently sending nothing.
 */
export async function sendEmail(kind: EmailKind, params: EmailParams): Promise<void> {
  if (!emailConfigured(kind)) {
    if (process.env.NODE_ENV === 'production') throw new EmailError('Email sending is not configured')
    // Development only: show what would have been sent
    console.log(`[DEV EMAIL] ${kind} to ${params.to_email}: ${params.code ?? params.reset_link}`)
    return
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id: process.env.EMAILJS_SERVICE_ID,
        template_id: process.env[TEMPLATE_ENV[kind]],
        user_id: process.env.EMAILJS_PUBLIC_KEY,
        accessToken: process.env.EMAILJS_PRIVATE_KEY,
        template_params: { ...params, app_name: 'LivoraPulse' },
      }),
      signal: controller.signal,
    })
  } catch {
    throw new EmailError('Could not reach the email service')
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    // Status only: the response can echo the request, which holds the code or link
    console.error(`[Email] EmailJS rejected a ${kind} email: HTTP ${res.status}`)
    throw new EmailError('The email service rejected the message', res.status)
  }
}
