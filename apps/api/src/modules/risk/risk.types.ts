export interface RiskAlertView {
  id: string;
  detectorType: string;
  severity: string;
  resourceType: string;
  resourceId: string;
  title: string;
  description: string;
  evidence: unknown;
  status: string;
  reviewedById: string | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  createdAt: string;
}

/**
 * The shared OUTPUT contract every detector produces — not a shared INPUT
 * signature, deliberately. A price-anomaly check needs a tenderLotId, a
 * split-procurement check needs an organizationId, a supplier-risk check
 * needs a supplierId: forcing those into one generic `run(context)` method
 * would mean an awkward union/unknown-typed context for no real benefit.
 * What's genuinely common is what gets handed to RiskAlertsService.raiseAlert()
 * once something is found — this interface documents that shape.
 */
export interface DetectionResult {
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  title: string;
  description: string;
  evidence: Record<string, unknown>;
}
