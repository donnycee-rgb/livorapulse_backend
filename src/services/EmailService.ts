// ─── Sending emails through the Apps Script mail relay ──────────────────────
// Emails are sent from the server, never from the browser: the browser must
// not see verification codes or reset tokens, or anyone could read them and
// skip the check.
//
// This server writes the whole email (subject, text and HTML) and posts it to
// a Google Apps Script web app (mail-relay/Code.gs), which sends it with
// MailApp from the Google account that deployed it. See mail-relay/README.md.
//
//   MAIL_RELAY_URL     the web app's /exec URL
//   MAIL_RELAY_SECRET  shared secret; must match RELAY_SECRET in Script Properties

const TIMEOUT_MS = 20_000 // Apps Script can take a few seconds to wake up
const APP_NAME = 'LivoraPulse'

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

export interface EmailMessage {
  subject: string
  text: string
  html: string
}

export function emailConfigured(): boolean {
  return !!process.env.MAIL_RELAY_URL && !!process.env.MAIL_RELAY_SECRET
}

export class EmailError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message)
    this.name = 'EmailError'
  }
}

// ─── Content ────────────────────────────────────────────────────────────────

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const firstName = (name: string) => name.trim().split(/\s+/)[0] || 'there'

/** Plain-text and HTML versions of one email. Inline styles only, because email clients ignore stylesheets. */
export function buildEmail(kind: EmailKind, p: EmailParams): EmailMessage {
  const name = firstName(p.to_name)
  const mins = p.expires_minutes
  const expiry = mins >= 60 && mins % 60 === 0 ? `${mins / 60} hour${mins === 60 ? '' : 's'}` : `${mins} minutes`

  const content =
    kind === 'verify'
      ? {
          subject: `Your ${APP_NAME} code: ${p.code}`,
          heading: 'Confirm your email',
          lines: [`Use this code to finish setting up your ${APP_NAME} account. It works for ${expiry}.`],
          code: p.code,
          footer: "If you didn't sign up, you can ignore this email.",
        }
      : {
          subject: `Reset your ${APP_NAME} password`,
          heading: 'Reset your password',
          lines: [`Someone asked to reset the password for your ${APP_NAME} account. The link works once, for ${expiry}.`],
          link: p.reset_link,
          footer: "If you didn't ask for this, you can ignore this email. Your password stays the same.",
        }

  const text = [
    `Hi ${name},`,
    '',
    ...content.lines,
    '',
    content.code ?? `Set a new password: ${content.link}`,
    '',
    content.footer,
    '',
    `— ${APP_NAME}`,
  ].join('\n')

  const action = content.code
    ? `<p style="margin:24px 0;font-size:32px;font-weight:bold;letter-spacing:8px;font-family:'Courier New',monospace;color:#111827;">${esc(content.code)}</p>`
    : `<p style="margin:24px 0;"><a href="${esc(content.link ?? '')}" style="display:inline-block;padding:12px 24px;background:#4F46E5;color:#FFFFFF;text-decoration:none;border-radius:8px;font-weight:bold;">Set a new password</a></p>` +
      `<p style="font-size:12px;color:#6B7280;word-break:break-all;">Or paste this link into your browser:<br>${esc(content.link ?? '')}</p>`

  const html =
    '<div style="background:#F3F4F6;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:#111827;">' +
    '<div style="max-width:520px;margin:0 auto;background:#FFFFFF;border-radius:12px;padding:32px 28px;">' +
    `<p style="margin:0;font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#4F46E5;font-weight:bold;">${APP_NAME}</p>` +
    `<h1 style="margin:16px 0 0;font-size:22px;">${esc(content.heading)}</h1>` +
    `<p style="font-size:15px;line-height:1.6;color:#374151;">Hi ${esc(name)},</p>` +
    content.lines.map((l) => `<p style="font-size:15px;line-height:1.6;color:#374151;">${esc(l)}</p>`).join('') +
    action +
    `<p style="margin:24px 0 0;font-size:12px;color:#6B7280;line-height:1.5;">${esc(content.footer)}</p>` +
    '</div></div>'

  return { subject: content.subject, text, html }
}

// ─── Sending ────────────────────────────────────────────────────────────────

/**
 * Sends one email. Without relay settings, development builds print it to
 * the server console instead; production refuses, so a missing setting is
 * noticed rather than silently sending nothing.
 */
export async function sendEmail(kind: EmailKind, params: EmailParams): Promise<void> {
  if (!emailConfigured()) {
    if (process.env.NODE_ENV === 'production') throw new EmailError('Email sending is not configured')
    // Development only: show what would have been sent
    console.log(`[DEV EMAIL] ${kind} to ${params.to_email}: ${params.code ?? params.reset_link}`)
    return
  }

  const message = buildEmail(kind, params)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let body: { ok?: boolean; code?: string } | null = null
  try {
    // Apps Script answers with a redirect to the result; fetch follows it
    const res = await fetch(process.env.MAIL_RELAY_URL!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: process.env.MAIL_RELAY_SECRET, to: params.to_email, ...message }),
      redirect: 'follow',
      signal: controller.signal,
    })
    if (res.ok) body = (await res.json().catch(() => null)) as typeof body
    else body = { ok: false, code: `HTTP_${res.status}` }
  } catch {
    throw new EmailError('Could not reach the email service')
  } finally {
    clearTimeout(timer)
  }

  // Apps Script always answers 200, so success is in the body
  if (!body || body.ok !== true) {
    // Code only: never log the message, which holds the code or link
    const code = body?.code ?? 'BAD_RESPONSE'
    console.error(`[Email] Mail relay rejected a ${kind} email: ${code}`)
    throw new EmailError('The email service rejected the message', code)
  }
}
