import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';
import { RiskAlertsService } from './risk-alerts.service';
import type { DetectionResult } from '../risk.types';
import type { EnvConfig } from '../../../config/env.validation';

const EARTH_RADIUS_METERS = 6_371_000;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Great-circle distance between two lat/lng points, in meters (haversine formula). */
function haversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

/**
 * GPS-tagged evidence capture (post-launch): the one automated check built
 * on top of the raw lat/lng UploadEvidenceDto now accepts. Both the
 * evidence's coordinates and the project's declared `siteLatitude`/
 * `siteLongitude` are optional and independently supplied — most evidence
 * (scanned documents, older uploads) will have neither, and that is not
 * itself suspicious. There is exactly one thing worth flagging: evidence
 * that DOES carry real GPS coordinates, for a project that DOES have a
 * declared site, and the two disagree by more than a generous margin —
 * evidence purportedly from the project site but actually captured
 * somewhere else entirely (stock photo, evidence recycled from a different
 * project, or a genuinely fabricated inspection).
 *
 * Pure detection only — see RiskAlertsService's own doc comment: this
 * engine has no code path that can block anything, only ever raises an
 * alert for a human with `risk:review` to act on. Evidence upload itself is
 * never blocked or rejected on the basis of a location mismatch.
 */
@Injectable()
export class EvidenceLocationDetector {
  private readonly logger = new Logger(EvidenceLocationDetector.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly riskAlertsService: RiskAlertsService,
    private readonly config: ConfigService<EnvConfig, true>,
  ) {}

  async evaluateEvidence(evidenceId: string): Promise<void> {
    try {
      const evidence = await this.prisma.projectEvidence.findUnique({
        where: { id: evidenceId },
      });
      if (
        !evidence ||
        evidence.latitude === null ||
        evidence.longitude === null
      ) {
        return;
      }

      const project = await this.prisma.project.findUnique({
        where: { id: evidence.projectId },
      });
      if (
        !project ||
        project.siteLatitude === null ||
        project.siteLongitude === null
      ) {
        return;
      }

      const distanceMeters = haversineDistanceMeters(
        evidence.latitude,
        evidence.longitude,
        project.siteLatitude,
        project.siteLongitude,
      );

      const thresholdMeters = this.config.get(
        'RISK_EVIDENCE_LOCATION_MISMATCH_METERS',
        { infer: true },
      );
      if (distanceMeters <= thresholdMeters) {
        return;
      }

      // Beyond 10x the configured margin, this is no longer plausibly GPS
      // drift or "the far edge of a big site" — same escalation shape as
      // DuplicatePaymentDetector's same-PO-vs-different-PO split.
      const severity =
        distanceMeters > thresholdMeters * 10 ? 'HIGH' : 'MEDIUM';

      const result: DetectionResult = {
        severity,
        title: 'Evidence captured far from the declared project site',
        description:
          `This evidence's recorded GPS coordinates are approximately ` +
          `${Math.round(distanceMeters).toLocaleString()}m from the project's ` +
          `declared site location, beyond the configured ${thresholdMeters}m margin.`,
        evidence: {
          evidenceId: evidence.id,
          projectId: project.id,
          evidenceLatitude: evidence.latitude,
          evidenceLongitude: evidence.longitude,
          siteLatitude: project.siteLatitude,
          siteLongitude: project.siteLongitude,
          distanceMeters: Math.round(distanceMeters),
          thresholdMeters,
        },
      };

      await this.riskAlertsService.raiseAlert(
        'EVIDENCE_LOCATION_MISMATCH',
        'ProjectEvidence',
        evidence.id,
        result,
      );
    } catch (error) {
      this.logger.error(
        `Evidence location detection failed for evidence ${evidenceId}`,
        error,
      );
    }
  }
}
