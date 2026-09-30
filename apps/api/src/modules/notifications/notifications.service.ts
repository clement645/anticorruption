import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service';
import { NOTIFICATION_ADAPTER } from './notifications.constants';
import type { EnvConfig } from '../../config/env.validation';
import type {
  NotificationAdapter,
  NotificationChannel,
  NotificationDispatchResult,
} from './notifications.types';

const SYSTEM_ACTOR_EMAIL = 'system:notifications';

function parseRecipients(csv: string): string[] {
  return csv
    .split(',')
    .map((r) => r.trim())
    .filter((r) => r.length > 0);
}

/**
 * Push notifications (post-launch, item 7): two purpose-built entry points,
 * not a generic "send anything anywhere" API — each one owns building its
 * own message content, so the discipline of WHAT is safe to put in a
 * notification body lives next to the trigger that knows the answer,
 * rather than being left to whichever caller remembers to redact
 * something. Both dispatch across every channel with at least one
 * configured recipient (NOTIFICATION_RECIPIENTS_SMS/_TELEGRAM/_WHATSAPP),
 * and both record ONE audit event per dispatch (not one per recipient —
 * that would bloat the audit trail for what is, today, always a
 * zero-recipient no-op) so the attempt is durably visible even though
 * LogOnlyNotificationAdapter never actually delivers anything. Once a real
 * adapter is plugged in, this same audit trail becomes the delivery
 * history.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @Inject(NOTIFICATION_ADAPTER)
    private readonly adapter: NotificationAdapter,
    private readonly auditService: AuditService,
    private readonly config: ConfigService<EnvConfig, true>,
  ) {}

  private recipientsFor(channel: NotificationChannel): string[] {
    const key =
      channel === 'SMS'
        ? 'NOTIFICATION_RECIPIENTS_SMS'
        : channel === 'TELEGRAM'
          ? 'NOTIFICATION_RECIPIENTS_TELEGRAM'
          : 'NOTIFICATION_RECIPIENTS_WHATSAPP';
    return parseRecipients(this.config.get(key, { infer: true }));
  }

  private async broadcast(
    subject: string,
    body: string,
    resourceType: string,
    resourceId: string,
  ): Promise<void> {
    const channels: NotificationChannel[] = ['SMS', 'TELEGRAM', 'WHATSAPP'];
    const results: NotificationDispatchResult[] = [];

    for (const channel of channels) {
      for (const recipient of this.recipientsFor(channel)) {
        try {
          results.push(
            await this.adapter.send({ channel, recipient, subject, body }),
          );
        } catch (error) {
          this.logger.error(
            `Notification dispatch failed on ${channel}`,
            error,
          );
        }
      }
    }

    await this.auditService.append({
      eventType: 'NOTIFICATION_DISPATCHED',
      actorEmail: SYSTEM_ACTOR_EMAIL,
      resourceType,
      resourceId,
      action: 'dispatch',
      payload: {
        subject,
        recipientCount: results.length,
        channels: [...new Set(results.map((r) => r.channel))],
        delivered: results.some((r) => r.delivered),
      },
    });
  }

  /** Called only for HIGH/CRITICAL alerts — see RiskAlertsService.raiseAlert(). */
  async notifyRiskAlert(alert: {
    id: string;
    detectorType: string;
    severity: string;
    resourceType: string;
    resourceId: string;
    title: string;
  }): Promise<void> {
    await this.broadcast(
      `[B-PFMPS] ${alert.severity} risk alert: ${alert.detectorType}`,
      `${alert.title} (${alert.resourceType} ${alert.resourceId}). Review at /risk-alerts/${alert.id}.`,
      'RiskAlert',
      alert.id,
    );
  }

  /**
   * Deliberately the SAME minimal fields already recorded on the
   * WHISTLEBLOWER_REPORT_SUBMITTED audit event (reportId + category, never
   * description/organizationId/contact) — this is the one action in the
   * entire codebase that must never be attributable to anyone, and a
   * notification body is just as capable of leaking that as an audit
   * payload would be. See WhistleblowerService.submitReport() and
   * THREAT_MODEL.md Phase 13.
   */
  async notifyWhistleblowerReportSubmitted(
    reportId: string,
    category: string,
  ): Promise<void> {
    await this.broadcast(
      `[B-PFMPS] New whistleblower report: ${category}`,
      `A new ${category} report was submitted. Review at /whistleblower/reports/${reportId}.`,
      'Report',
      reportId,
    );
  }
}
