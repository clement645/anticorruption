import { Injectable, Logger } from '@nestjs/common';
import type {
  NotificationAdapter,
  NotificationDispatchResult,
  NotificationMessage,
} from './notifications.types';

const PROVIDER_NAME = 'log-only';

/**
 * The only NotificationAdapter this deployment has — see
 * notifications.types.ts for why. Never contacts any real SMS/Telegram/
 * WhatsApp provider; logs what WOULD have been sent and honestly reports
 * `delivered: false`. `body` is logged in full (never redacted) since
 * NotificationsService only ever builds non-identifying, already-audited
 * content (see its own doc comment) — there is nothing here a log line
 * could leak that the audit trail doesn't already record.
 */
@Injectable()
export class LogOnlyNotificationAdapter implements NotificationAdapter {
  private readonly logger = new Logger(LogOnlyNotificationAdapter.name);

  send(message: NotificationMessage): Promise<NotificationDispatchResult> {
    this.logger.log(
      `[LOG-ONLY] Would send ${message.channel} to ${message.recipient}: ` +
        `"${message.subject}" — ${message.body}`,
    );
    return Promise.resolve({
      channel: message.channel,
      recipient: message.recipient,
      delivered: false,
      provider: PROVIDER_NAME,
    });
  }
}
