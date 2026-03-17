import jwt from 'jsonwebtoken'

export interface TokenPayload {
  id: string
  email: string
}

function requireSecret(name: string): string {
  const val = process.env[name]
  if (!val) throw new Error(`${name} environment variable is not set`)
  return val
}

export function signAccessToken(payload: TokenPayload): string {
  return jwt.sign(payload, requireSecret('JWT_ACCESS_SECRET'), {
    expiresIn: (process.env.JWT_ACCESS_EXPIRES_IN ?? '15m') as unknown as number,
  })
}

export function signRefreshToken(payload: TokenPayload): string {
  return jwt.sign(payload, requireSecret('JWT_REFRESH_SECRET'), {
    expiresIn: (process.env.JWT_REFRESH_EXPIRES_IN ?? '30d') as unknown as number,
  })
}

export function verifyAccessToken(token: string): TokenPayload {
  return jwt.verify(token, requireSecret('JWT_ACCESS_SECRET')) as TokenPayload
}

export function verifyRefreshToken(token: string): TokenPayload {
  return jwt.verify(token, requireSecret('JWT_REFRESH_SECRET')) as TokenPayload
}

/**
 * Parse a duration string like "30d", "15m", "1h" into a future Date.
 * Used to store refresh token expiry in the DB.
 */
export function parseDurationToDate(duration: string): Date {
  const now = new Date()
  const match = /^(\d+)([smhd])$/.exec(duration)
  if (!match) {
    now.setDate(now.getDate() + 30)
    return now
  }
  const amount = parseInt(match[1] ?? '30', 10)
  const unit = match[2]
  switch (unit) {
    case 's': now.setSeconds(now.getSeconds() + amount); break
    case 'm': now.setMinutes(now.getMinutes() + amount); break
    case 'h': now.setHours(now.getHours() + amount); break
    case 'd': now.setDate(now.getDate() + amount); break
  }
  return now
}