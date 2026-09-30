/**
 * Push notifications (post-launch, item 7) — SMS/Telegram/WhatsApp. Real
 * delivery requires a third-party account this project doesn't have
 * (Twilio, a Telegram bot token, WhatsApp Business API), so — per the
 * user's own explicit sequencing decision for this class of feature
 * ("build as pluggable adapters, log-only for now") — only a log-only
 * adapter exists today. Business code depends only on this interface,
 * never on a concrete provider, so a real adapter can be swapped in later
 * (`LogOnlyNotificationAdapter` → e.g. a future `TwilioNotificationAdapter`)
 * without any caller changing — the same shape as `BlockchainAdapter`/
 * `ObjectStorageAdapter`.
 *
 * Deliberately kept inside apps/api rather than promoted to its own
 * `packages/notifications` workspace package (unlike blockchain/storage):
 * neither this interface nor its adapter is consumed anywhere outside
 * apps/api, and blockchain/storage's own package split was never actually
 * about cross-package sharing either (apps/web imports neither) — it's a
 * convention for "swappable infrastructure", which a single small module
 * already delivers without the extra workspace-package overhead.
 */

export type NotificationChannel = 'SMS' | 'TELEGRAM' | 'WHATSAPP';

export interface NotificationMessage {
  channel: NotificationChannel;
  /** Phone number (SMS/WhatsApp) or chat id (Telegram) — deliberately opaque, provider-specific. */
  recipient: string;
  subject: string;
  body: string;
}

export interface NotificationDispatchResult {
  channel: NotificationChannel;
  recipient: string;
  /** Honest by construction: a log-only adapter never actually delivers anything. */
  delivered: boolean;
  provider: string;
}

export interface NotificationAdapter {
  send(message: NotificationMessage): Promise<NotificationDispatchResult>;
}
