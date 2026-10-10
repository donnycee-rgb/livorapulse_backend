import { afterEach, describe, expect, it, vi } from 'vitest'
import { EmailError, buildEmail, emailConfigured, sendEmail } from '../src/services/EmailService'

const RELAY_URL = 'https://script.google.com/macros/s/test/exec'
const configure = () => {
  vi.stubEnv('MAIL_RELAY_URL', RELAY_URL)
  vi.stubEnv('MAIL_RELAY_SECRET', 'secret_x')
}
const relayAnswers = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('buildEmail', () => {
  it('puts the code in the subject, text and HTML of a verify email', () => {
    const m = buildEmail('verify', { to_email: 'a@example.test', to_name: 'Ada Lovelace', code: '123456', expires_minutes: 15 })
    expect(m.subject).toContain('123456')
    expect(m.text).toContain('Hi Ada,')
    expect(m.text).toContain('123456')
    expect(m.text).toContain('15 minutes')
    expect(m.html).toContain('123456')
  })

  it('links to the reset page and says how long it lasts', () => {
    const m = buildEmail('reset', { to_email: 'a@example.test', to_name: 'A', reset_link: 'https://x/reset?token=t', expires_minutes: 60 })
    expect(m.text).toContain('https://x/reset?token=t')
    expect(m.text).toContain('1 hour')
    expect(m.html).toContain('href="https://x/reset?token=t"')
  })

  it("escapes the user's name in the HTML", () => {
    const m = buildEmail('verify', { to_email: 'a@example.test', to_name: '<b>x</b>', code: '1', expires_minutes: 15 })
    expect(m.html).not.toContain('<b>x</b>')
    expect(m.html).toContain('&lt;b&gt;x&lt;/b&gt;')
  })
})

describe('sendEmail', () => {
  it('posts the finished email and the secret to the relay', async () => {
    configure()
    const fetchMock = relayAnswers({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    const params = { to_email: 'a@example.test', to_name: 'A', code: '123456', expires_minutes: 15 }
    await sendEmail('verify', params)

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(RELAY_URL)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ secret: 'secret_x', to: 'a@example.test', ...buildEmail('verify', params) })
  })

  it('throws when the relay refuses, logging the code but never the email', async () => {
    configure()
    vi.stubGlobal('fetch', relayAnswers({ ok: false, code: 'UNAUTHORIZED' }))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(sendEmail('verify', { to_email: 'a@example.test', to_name: 'A', code: '654321', expires_minutes: 15 }))
      .rejects.toMatchObject({ name: 'EmailError', code: 'UNAUTHORIZED' })
    expect(log.mock.calls.flat().join(' ')).toContain('UNAUTHORIZED')
    expect(log.mock.calls.flat().join(' ')).not.toContain('654321')
  })

  it('throws when the relay answers with an HTTP error', async () => {
    configure()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Error</html>', { status: 500 })))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(sendEmail('reset', { to_email: 'a@example.test', to_name: 'A', reset_link: 'https://x', expires_minutes: 60 }))
      .rejects.toMatchObject({ code: 'HTTP_500' })
  })

  it("throws when the relay's answer isn't JSON (e.g. a Google sign-in page)", async () => {
    configure()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Sign in</html>', { status: 200 })))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(sendEmail('verify', { to_email: 'a@example.test', to_name: 'A', code: '1', expires_minutes: 15 }))
      .rejects.toMatchObject({ code: 'BAD_RESPONSE' })
  })

  it('throws when the relay cannot be reached', async () => {
    configure()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    await expect(sendEmail('verify', { to_email: 'a@example.test', to_name: 'A', code: '1', expires_minutes: 15 })).rejects.toBeInstanceOf(EmailError)
  })

  it('in development without settings, prints the email instead of sending', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('MAIL_RELAY_URL', '')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await sendEmail('verify', { to_email: 'a@example.test', to_name: 'A', code: '123456', expires_minutes: 15 })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(log.mock.calls.flat().join(' ')).toContain('123456')
  })

  it('in production without settings, refuses instead of silently sending nothing', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('MAIL_RELAY_URL', '')
    await expect(sendEmail('verify', { to_email: 'a@example.test', to_name: 'A', code: '1', expires_minutes: 15 })).rejects.toBeInstanceOf(EmailError)
  })

  it('needs both the URL and the secret', () => {
    vi.stubEnv('MAIL_RELAY_URL', RELAY_URL)
    vi.stubEnv('MAIL_RELAY_SECRET', '')
    expect(emailConfigured()).toBe(false)
    vi.stubEnv('MAIL_RELAY_SECRET', 's')
    expect(emailConfigured()).toBe(true)
  })
})
