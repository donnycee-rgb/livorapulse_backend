import webpush from 'web-push'
import { prisma } from '../db/prisma'

// ─── Phone notifications (Web Push) ─────────────────────────────────────────
// Each phone or browser that allowed notifications gave us an address
// (PushSubscription). Sending goes through the browser maker's push service
// (Google, Apple, Mozilla), signed with our VAPID keys, so it arrives even
// when LivoraPulse is closed.
//
// Needs VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT (a mailto: or
// https: contact). Generate the keys once: npx web-push generate-vapid-keys

export type PushMessage = {
  title: string
  body: string
  /** Where tapping the notification opens */
  url: string
  /** Replaces an earlier notification with the same tag instead of stacking */
  tag?: string
  /** Buttons on the notification (Android, desktop): each opens its own url */
  actions?: Array<{ action: string; title: string; url: string }>
}

const publicKey = process.env.VAPID_PUBLIC_KEY ?? ''
const privateKey = process.env.VAPID_PRIVATE_KEY ?? ''
const subject = process.env.VAPID_SUBJECT ?? ''

export const pushConfigured = Boolean(publicKey && privateKey && subject)
if (pushConfigured) webpush.setVapidDetails(subject, publicKey, privateKey)

export const vapidPublicKey = () => (pushConfigured ? publicKey : null)

type Sender = (sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string) => Promise<unknown>
let sender: Sender = (sub, payload) => webpush.sendNotification(sub, payload, { TTL: 60 * 60 })
let fakeSender = false
/** Tests swap the real sender for a fake one */
export function setPushSender(fn: Sender): void { sender = fn; fakeSender = true }
/** Can notifications be sent at all (keys set, or a test sender)? */
export const pushReady = () => pushConfigured || fakeSender

/**
 * Send to every phone/browser the person allowed. Addresses the push
 * service says are gone (uninstalled, permission removed) are deleted.
 * Returns how many were delivered.
 */
export async function sendToUser(userId: string, msg: PushMessage): Promise<number> {
  if (!pushReady()) return 0
  const subs = await prisma.pushSubscription.findMany({ where: { userId } })
  let sent = 0
  for (const s of subs) {
    try {
      await sender({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(msg))
      sent++
      await prisma.pushSubscription.update({ where: { id: s.id }, data: { lastUsedAt: new Date() } })
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode
      if (status === 404 || status === 410) {
        await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => null)
      } else {
        console.error('[Push] send failed:', status ?? (err as Error).message)
      }
    }
  }
  return sent
}
