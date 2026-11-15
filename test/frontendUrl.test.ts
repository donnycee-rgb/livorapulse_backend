import { afterEach, describe, expect, it } from 'vitest'
import { frontendUrl } from '../src/utils/frontendUrl'

const saved = process.env.FRONTEND_URL
afterEach(() => { process.env.FRONTEND_URL = saved })

describe('frontendUrl', () => {
  it('drops trailing slashes so links never get "//"', () => {
    process.env.FRONTEND_URL = 'https://livorapulse.netlify.app/'
    expect(`${frontendUrl()}/dashboard`).toBe('https://livorapulse.netlify.app/dashboard')
    process.env.FRONTEND_URL = 'https://livorapulse.netlify.app//  '
    expect(frontendUrl()).toBe('https://livorapulse.netlify.app')
  })

  it('keeps a clean URL as it is, and defaults for local development', () => {
    process.env.FRONTEND_URL = 'https://livorapulse.netlify.app'
    expect(frontendUrl()).toBe('https://livorapulse.netlify.app')
    delete process.env.FRONTEND_URL
    expect(frontendUrl()).toBe('http://localhost:5173')
  })
})
