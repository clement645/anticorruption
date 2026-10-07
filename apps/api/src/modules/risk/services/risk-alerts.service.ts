import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, RiskAlert, RiskDetectorType } from '@bpfmps/database';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { NotificationsService } from '../../notifications/notifications.service';
import type { ReviewAlertDto } from '../dto/review-alert.dto';
import type { DetectionResult, RiskAlertView } from '../risk.types';

type Actor = { sub: string; email: string; organizationId: string | null };
type RequestMeta = { ipAddress?: string; userAgent?: string };

const SYSTEM_ACTOR_EMAIL = 'system:risk-engine';

function toView(alert: RiskAlert): RiskAlertView {
  return {
    id: alert.id,
    detectorType: alert.detectorType,
    severity: alert.severity,
    resourceType: alert.resourceType,
    resourceId: alert.resourceId,
    title: alert.title,
    description: alert.description,
    evidence: alert.evidence,
    status: alert.status,
    reviewedById: alert.reviewedById,
    reviewedAt: alert.reviewedAt ? alert.reviewedAt.toISOString() : null,
    reviewNotes: alert.reviewNotes,
    createdAt: alert.createdAt.toISOString(),
  };
}

/**
 * The single sink every detector writes to. Detectors can only ever call
 * raiseAlert() — an additive, non-blocking operation — never reject or
 * mutate the business action that triggered them. That is the actual
 * implementation of "human-review gate before any adverse action" (section
 * 8/17): the engine has no code path that can block anything; it can only
 * ever queue something for a human with `risk:review` to act on.
 */
@Injectable()
export class RiskAlertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Skips creating a duplicate when an OPEN or UNDER_REVIEW alert already
   * exists for the same detector+resource — re-running a detector against
   * data that hasn't changed shouldn't spam the review queue. Once an alert
   * is resolved (CONFIRMED/DISMISSED), a fresh finding can raise a new one.
   */
  async raiseAlert(
    detectorType: RiskDetectorType,
    resourceType: string,
    resourceId: string,
    result: DetectionResult,
  ): Promise<RiskAlertView | null> {
    const existing = await this.prisma.riskAlert.findFirst({
      where: {
        detectorType,
        resourceType,
        resourceId,
        status: { in: ['OPEN', 'UNDER_REVIEW'] },
      },
    });
    if (existing) {
      return null;
    }

    const alert = await this.prisma.riskAlert.create({
      data: {
        detectorType,
        severity: result.severity,
        resourceType,
        resourceId,
        title: result.title,
        description: result.description,
        evidence: result.evidence as Prisma.InputJsonValue,
      },
    });

    await this.auditService.append({
      eventType: 'RISK_ALERT_RAISED',
      actorEmail: SYSTEM_ACTOR_EMAIL,
      resourceType: 'RiskAlert',
      resourceId: alert.id,
      action: 'create',
      payload: {
        alertId: alert.id,
        detectorType,
        severity: result.severity,
        resourceType,
        resourceId,
      },
    });

    // Push notifications (post-launch, item 7): only the genuinely urgent
    // tier — a LOW/MEDIUM alert queues for ordinary review, same as always,
    // never interrupts anyone.
    if (result.severity === 'HIGH' || result.severity === 'CRITICAL') {
      await this.notificationsService.notifyRiskAlert({
        id: alert.id,
        detectorType,
        severity: result.severity,
        resourceType,
        resourceId,
        title: result.title,
      });
    }

    return toView(alert);
  }

  /**
   * Counts by severity, computed in the database. The dashboard uses this rather
   * than listing every alert just to count them.
   */
  async summary(status?: string): Promise<{
    total: number;
    bySeverity: Record<'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL', number>;
  }> {
    const where = status ? { status: status as never } : {};
    const groups = await this.prisma.riskAlert.groupBy({
      by: ['severity'],
      where,
      _count: { _all: true },
    });
    const bySeverity = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
    let total = 0;
    for (const group of groups) {
      bySeverity[group.severity] = group._count._all;
      total += group._count._all;
    }
    return { total, bySeverity };
  }

  /**
   * Paginated — this table is written by background detectors, not people,
   * so it has no natural upper bound the way a hand-entered list does. An
   * earlier unbounded version of this query was found, during Phase 10 QA,
   * to return every row in the table (thousands, tens of MB) on first paint
   * of the Risk Alerts screen; `summary()` above already existed for the
   * dashboard's counts, but the list itself had never been capped.
   */
  async list(params: {
    status?: string;
    severity?: string;
    detectorType?: string;
    resourceType?: string;
    resourceId?: string;
    skip?: number;
    take?: number;
  }): Promise<{ items: RiskAlertView[]; total: number }> {
    const where: Prisma.RiskAlertWhereInput = {
      ...(params.status ? { status: params.status as never } : {}),
      ...(params.severity ? { severity: params.severity as never } : {}),
      ...(params.detectorType
        ? { detectorType: params.detectorType as never }
        : {}),
      ...(params.resourceType ? { resourceType: params.resourceType } : {}),
      ...(params.resourceId ? { resourceId: params.resourceId } : {}),
    };
    const [alerts, total] = await this.prisma.$transaction([
      this.prisma.riskAlert.findMany({
        where,
        skip: params.skip ?? 0,
        take: Math.min(params.take ?? 25, 100),
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.riskAlert.count({ where }),
    ]);
    return { items: alerts.map(toView), total };
  }

  async getByIdOrThrow(id: string): Promise<RiskAlert> {
    const alert = await this.prisma.riskAlert.findUnique({ where: { id } });
    if (!alert) {
      throw new NotFoundException('Risk alert not found');
    }
    return alert;
  }

  async getView(id: string): Promise<RiskAlertView> {
    return toView(await this.getByIdOrThrow(id));
  }

  async review(
    id: string,
    dto: ReviewAlertDto,
    actor: Actor,
    requestMeta: RequestMeta,
  ): Promise<RiskAlertView> {
    const alert = await this.getByIdOrThrow(id);
    if (alert.status === 'CONFIRMED' || alert.status === 'DISMISSED') {
      throw new BadRequestException(
        `Cannot review an alert already ${alert.status}`,
      );
    }

    const updated = await this.prisma.riskAlert.update({
      where: { id },
      data: {
        status: dto.status,
        reviewedById: actor.sub,
        reviewedAt: new Date(),
        reviewNotes: dto.notes,
      },
    });

    await this.auditService.append({
      eventType: 'RISK_ALERT_REVIEWED',
      actorId: actor.sub,
      actorEmail: actor.email,
      organizationId: actor.organizationId ?? undefined,
      resourceType: 'RiskAlert',
      resourceId: id,
      action: 'review',
      payload: { alertId: id, status: dto.status, notes: dto.notes },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    });

    return toView(updated);
  }
}
