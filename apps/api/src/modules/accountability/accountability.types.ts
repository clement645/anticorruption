/**
 * Public, named per-official accountability scorecards — item 4 of the
 * post-launch "highest impact first" anti-corruption feature sequence.
 *
 * DELIBERATE, EXPLICIT EXCEPTION to the Phase 12 Transparency Portal's rule
 * ("no individual actor's identity — none of it, anywhere" — see
 * transparency.types.ts and SECURITY.md § Public Transparency Surface):
 * this module exists specifically to publish named officials' track
 * records, because that IS the point of an accountability scorecard. The
 * user was asked directly whether this should reverse that boundary
 * (rather than assumed) and explicitly chose "public with names" over
 * "internal only" and "public, org-level only" — see SECURITY.md § Public
 * Accountability Scorecards for the full record of that decision.
 *
 * Still deliberately excluded, even having chosen the public+named option:
 * email/phone (no operational reason to expose it here — the ask was
 * names and track records, not contact details), and the CONTENT of any
 * individual risk alert (only the aggregate flagged-action count/rate —
 * publishing live investigation detail would be a real operational-security
 * problem distinct from the identity question already decided).
 */

export interface PublicOfficialScorecard {
  userId: string;
  firstName: string;
  lastName: string;
  organizationName: string | null;
  roles: string[];
  totalActions: number;
  budgetsApproved: { count: number; totalAmount: string };
  procurementRequestsApproved: { count: number; totalAmount: string };
  awardsMade: {
    count: number;
    totalAmount: string;
    distinctSuppliers: number;
    vendorDiversityRatio: number | null;
  };
  invoicesVerified: { count: number; totalAmount: string };
  paymentsApproved: { count: number; totalAmount: string };
  inspectionsConducted: {
    count: number;
    passed: number;
    failed: number;
    needsRevision: number;
  };
  /** How many of this official's actions above were on a resource that has ANY risk alert (any severity/status) against it. */
  riskFlaggedActionCount: number;
  /** 1 - (riskFlaggedActionCount / totalActions), or null when totalActions is 0. */
  complianceRate: number | null;
}
