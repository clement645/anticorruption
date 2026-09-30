/**
 * DI token for the active NotificationAdapter. Business code injects this
 * token, never a concrete adapter class — mirrors BLOCKCHAIN_ADAPTER/
 * OBJECT_STORAGE_ADAPTER: swapping `LogOnlyNotificationAdapter` for a
 * future real provider (Twilio, Telegram Bot API, WhatsApp Business API)
 * is a one-line change to the provider in notifications.module.ts.
 */
export const NOTIFICATION_ADAPTER = Symbol('NOTIFICATION_ADAPTER');
