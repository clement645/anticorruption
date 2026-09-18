import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, RiskAlert, RiskDetectorType } from '@bpfmps/database';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
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

    return toView(alert);
  }

  async list(params: {
    status?: string;
    severity?: string;
    detectorType?: string;
    resourceType?: string;
    resourceId?: string;
  }): Promise<RiskAlertView[]> {
    const alerts = await this.prisma.riskAlert.findMany({
      where: {
        ...(params.status ? { status: params.status as never } : {}),
        ...(params.severity ? { severity: params.severity as never } : {}),
        ...(params.detectorType
          ? { detectorType: params.detectorType as never }
          : {}),
        ...(params.resourceType ? { resourceType: params.resourceType } : {}),
        ...(params.resourceId ? { resourceId: params.resourceId } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
    return alerts.map(toView);
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
