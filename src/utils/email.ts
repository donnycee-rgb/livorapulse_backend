import { prisma } from '../db/prisma'

// ─── Email addresses ────────────────────────────────────────────────────────
// Emails are stored in lowercase, so "John@Example.com" and "john@example.com"
// are the same account however they are typed (phones often capitalise the
// first letter).

export const normalizeEmail = (email: string): string => email.trim().toLowerCase()

/**
 * The id of the account with this email, ignoring capitals and spaces.
 * Exact match first (every email stored since lowercasing began); then a
 * case-insensitive match for an older address that couldn't be lowercased
 * because another account has the same address in different capitals.
 */
export async function findUserIdByEmail(email: string): Promise<string | null> {
  const normalized = normalizeEmail(email)
  const exact = await prisma.user.findUnique({ where: { email: normalized }, select: { id: true } })
  if (exact) return exact.id
  const loose = await prisma.user.findFirst({
    where: { email: { equals: normalized, mode: 'insensitive' } },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  })
  return loose?.id ?? null
}
