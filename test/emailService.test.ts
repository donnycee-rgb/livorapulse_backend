import { afterEach, describe, expect, it, vi } from 'vitest'
import { EmailError, emailConfigured, sendEmail } from '../src/services/EmailService'

const CONFIG = {
  EMAILJS_SERVICE_ID: 'service_x',
  EMAILJS_PUBLIC_KEY: 'public_x',
  EMAILJS_PRIVATE_KEY: 'private_x',
  EMAILJS_TEMPLATE_VERIFY: 'template_verify',
  EMAILJS_TEMPLATE_RESET: 'template_reset',
}
const configure = () => Object.entries(CONFIG).forEach(([k, v]) => vi.stubEnv(k, v))

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('sendEmail', () => {
  it("calls EmailJS's REST API with the private key and the template for the email", async () => {
    configure()
    const fetchMock = vi.fn(async () => new Response('OK', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await sendEmail('verify', { to_email: 'a@example.test', to_name: 'A', code: '123456', expires_minutes: 15 })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.emailjs.com/api/v1.0/email/send')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({
      service_id: 'service_x',
      template_id: 'template_verify',
      user_id: 'public_x',
      accessToken: 'private_x',
      template_params: { to_email: 'a@example.test', to_name: 'A', code: '123456', expires_minutes: 15, app_name: 'LivoraPulse' },
    })
  })

  it('uses the reset template for reset emails', async () => {
    configure()
    const fetchMock = vi.fn(async () => new Response('OK', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await sendEmail('reset', { to_email: 'a@example.test', to_name: 'A', reset_link: 'https://x/reset', expires_minutes: 60 })
    expect(JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).template_id).toBe('template_reset')
  })

  it('throws when EmailJS refuses, logging the status but never the code', async () => {
    configure()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('The Private Key is invalid', { status: 403 })))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(sendEmail('verify', { to_email: 'a@example.test', to_name: 'A', code: '654321', expires_minutes: 15 }))
      .rejects.toMatchObject({ name: 'EmailError', status: 403 })
    expect(log.mock.calls.flat().join(' ')).not.toContain('654321')
  })

  it('throws when EmailJS cannot be reached', async () => {
    configure()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    await expect(sendEmail('verify', { to_email: 'a@example.test', to_name: 'A', code: '1', expires_minutes: 15 })).rejects.toBeInstanceOf(EmailError)
  })

  it('in development without settings, prints the email instead of sending', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await sendEmail('verify', { to_email: 'a@example.test', to_name: 'A', code: '123456', expires_minutes: 15 })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(log.mock.calls.flat().join(' ')).toContain('123456')
  })

  it('in production without settings, refuses instead of silently sending nothing', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    await expect(sendEmail('verify', { to_email: 'a@example.test', to_name: 'A', code: '1', expires_minutes: 15 })).rejects.toBeInstanceOf(EmailError)
  })

  it('knows which emails are configured', () => {
    vi.stubEnv('EMAILJS_SERVICE_ID', 's')
    vi.stubEnv('EMAILJS_PUBLIC_KEY', 'p')
    vi.stubEnv('EMAILJS_PRIVATE_KEY', 'k')
    vi.stubEnv('EMAILJS_TEMPLATE_VERIFY', 't')
    vi.stubEnv('EMAILJS_TEMPLATE_RESET', '')
    expect(emailConfigured('verify')).toBe(true)
    expect(emailConfigured('reset')).toBe(false)
  })
})
