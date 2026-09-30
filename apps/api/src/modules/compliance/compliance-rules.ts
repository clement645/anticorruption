/**
 * Legal & policy integration layer (post-launch feature). A citable registry
 * of the specific legal/constitutional provisions this system's controls are
 * designed against — the point being that a citizen, auditor, or oversight
 * body can look at ONE place and see exactly which rule a given control
 * implements, rather than having to infer it from scattered code comments.
 *
 * Honesty constraint that shaped this file (see SECURITY.md § Legal & Policy
 * Integration for the full account): Kenyan procurement law changes by
 * periodic PPRA/National Treasury regulation, and this system has no way to
 * auto-verify a citation against the current Kenya Gazette. Every citation
 * below was independently verified against the actual text of the cited
 * instrument at the time it was added (not recalled from memory) — see each
 * rule's `verifiedAgainst` field. Four categories of rule exist:
 *
 * - `enforcement: 'preventive'` — a specific, real, currently-running check
 *   in this codebase that can BLOCK an action. `enforcedBy` names the exact
 *   file/function.
 * - `enforcement: 'detective'` — a real, currently-running check that flags
 *   an already-taken action for independent human review, rather than
 *   blocking it outright (used where blocking would be too disruptive for
 *   legitimate edge cases).
 * - `enforcement: 'design-principle'` — NOT a specific automated numeric
 *   check. These cite provisions whose exact figures/procedures this system
 *   does not attempt to hard-code (e.g. the procurement-method threshold
 *   matrix, which the PPRA revises by regulation) because doing so with an
 *   unverified number would be worse than not encoding it at all — a wrong
 *   "enforced" threshold is more dangerous than an honestly-absent one. The
 *   `description` says what a real deployment must confirm before treating
 *   the referenced figures as authoritative.
 * - `enforcement: 'transparency'` — not a check at all, a real, live public
 *   disclosure mechanism. Used for the accountability-scorecards item below,
 *   which required a genuine policy decision (asked of, and made by, the
 *   user directly — see SECURITY.md § Public Accountability Scorecards)
 *   rather than an engineering judgment call, since it deliberately reverses
 *   the Phase 12 Transparency Portal's separate "no individual identity,
 *   anywhere" rule for this one surface.
 */

export type ComplianceEnforcement =
  'preventive' | 'detective' | 'design-principle' | 'transparency';

export interface ComplianceRule {
  id: string;
  title: string;
  citation: string;
  verifiedAgainst: string;
  description: string;
  enforcement: ComplianceEnforcement;
  enforcedBy: string;
}

export const COMPLIANCE_RULES: ComplianceRule[] = [
  {
    id: 'no-contract-splitting',
    title: 'Prohibition on splitting procurement to evade scrutiny thresholds',
    citation:
      'Public Procurement and Asset Disposal Regulations, 2020 (Legal Notice No. 69 of 2020), Regulation 43',
    verifiedAgainst:
      'Table of contents of the Regulations, confirmed via Kenya Gazette Supplement No. 53, 22 April 2020 (Legislative Supplement No. 37), which lists Regulation 43 as "Procurement pricing and requirement not to split contracts."',
    description:
      'An organization cannot have further procurement requests approved while an unresolved HIGH-severity pattern of several under-threshold requests combining into one large total is open — the classic single-large-purchase-disguised-as-many-small-ones evasion. Approval is blocked, not just logged, until an Auditor or Internal Auditor independently reviews and resolves the flag.',
    enforcement: 'preventive',
    enforcedBy:
      'apps/api/src/modules/risk/services/split-procurement.detector.ts (SplitProcurementDetector.findBlockingAlert, called from ProcurementRequestsService.approve before the budget commitment is created)',
  },
  {
    id: 'tiered-procurement-methods',
    title: 'Procurement method must match contract value (threshold matrix)',
    citation:
      'Public Procurement and Asset Disposal Regulations, 2020, Regulation 26 (Threshold matrix) and the Second Schedule',
    verifiedAgainst:
      "Table of contents of the Regulations (Regulation 26 title confirmed directly). The Second Schedule's specific KES figures were NOT independently confirmed for the current in-force version — the only complete matrix this system could access was a 2006 Legal Notice under the since-repealed 2005 Act, whose exact numbers cannot be assumed still current.",
    description:
      "Kenyan procurement law tiers the permitted procurement method (open tender, restricted tender, request for quotations, direct procurement, low-value procurement) by estimated contract value and procuring-entity class, with open tendering as the default for higher-value contracts. This system's procurement workflow currently only implements the competitive tender path end-to-end (there is no direct-procurement/single-sourcing shortcut to abuse), which is itself a structural control. A real deployment MUST confirm the current Second Schedule figures directly from PPRA (ppra.go.ke) or the Kenya Law Reports before building or configuring any lower-value alternative procurement path.",
    enforcement: 'design-principle',
    enforcedBy: 'N/A — see description for why this is not a hard-coded check',
  },
  {
    id: 'fair-competitive-procurement',
    title:
      'Fair, equitable, transparent, competitive and cost-effective procurement',
    citation: 'Constitution of Kenya, 2010, Article 227(1)',
    verifiedAgainst:
      'Widely and consistently cited as the foundational constitutional procurement clause across Kenyan legal and procurement literature; the five listed principles (fair, equitable, transparent, competitive, cost-effective) are stable and not subject to periodic regulatory amendment the way numeric thresholds are.',
    description:
      'The overarching principle every procurement control in this system exists to serve: open, competitive tendering as the default path (Phase 6), independent bid evaluation separate from the requester (Phase 6 separation of duties), and public transparency of award outcomes (Phase 12).',
    enforcement: 'design-principle',
    enforcedBy:
      'apps/api/src/modules/procurement/ (tender/bid/evaluation/award lifecycle) and apps/api/src/modules/transparency/ (public disclosure)',
  },
  {
    id: 'auditor-general-oversight',
    title: 'Independent audit of public funds and immutable financial records',
    citation:
      'Constitution of Kenya, 2010, Article 229 (functions of the Auditor-General)',
    verifiedAgainst:
      "Widely and consistently cited as the constitutional basis for the Auditor-General's audit mandate over public funds; stable, not subject to periodic regulatory amendment.",
    description:
      'Every financial and procurement decision in this system is recorded on an append-only, hash-chained, digitally-signed audit trail that an Auditor role can independently reconstruct and verify — never a mutable log an implicated official could edit after the fact.',
    enforcement: 'detective',
    enforcedBy:
      'apps/api/src/modules/audit/ (Phase 3) and apps/api/src/modules/iam/guards/signature.guard.ts (post-launch per-official signatures)',
  },
  {
    id: 'no-over-invoicing',
    title:
      "A purchase order's cumulative invoiced amount cannot exceed its authorized amount",
    citation:
      'General public financial control principle underlying the Public Finance Management Act, 2012 (not tied to a single specific section here — see description)',
    verifiedAgainst:
      'Deliberately NOT cited to a specific PFM Act section number, for the same reason as the separation-of-duties rule below: asserting a precise section citation without independently verifying it would be worse than stating the general, well-established principle honestly.',
    description:
      'A purchase order authorizes a specific ceiling amount; no invoice may be recorded against it once the sum of all its non-rejected invoices would exceed that ceiling. This also structurally closes the simplest form of duplicate-payment fraud (resubmitting a full-amount invoice a second time), since a second identical invoice almost always breaches the ceiling on its own.',
    enforcement: 'preventive',
    enforcedBy:
      'apps/api/src/modules/contracts/services/invoices.service.ts (InvoicesService.create, checked before the invoice row is created)',
  },
  {
    id: 'duplicate-payment-detection',
    title:
      'Flag a supplier invoicing the identical amount more than once in a short window',
    citation:
      'Supports the same general public financial control principle as no-over-invoicing above — this is the DETECTIVE complement for the case that check cannot catch on its own (a purchase order large enough that two identical-amount invoices both fit under its ceiling, or two different purchase orders billed for what may be the same delivery).',
    verifiedAgainst:
      'N/A — a detection heuristic, not a citation of a specific legal provision.',
    description:
      'When the same supplier submits another invoice at the exact same amount within the configured window (RISK_DUPLICATE_PAYMENT_WINDOW_DAYS, default 90 days), a risk alert is raised — HIGH severity if against the same purchase order, MEDIUM if a different one. This is detection for independent human review, not a block: identical recurring amounts can have innocent explanations, so unlike no-over-invoicing above this does not stop the invoice from being recorded.',
    enforcement: 'detective',
    enforcedBy:
      'apps/api/src/modules/risk/services/duplicate-payment.detector.ts (DuplicatePaymentDetector.evaluateInvoice, called after every invoice is recorded)',
  },
  {
    id: 'separation-of-duties-financial-controls',
    title: 'Separation of duties in financial authorization',
    citation:
      "General internal-control principle underlying the Public Finance Management Act, 2012's financial-control framework (not tied to a single specific section here — see description)",
    verifiedAgainst:
      'Deliberately NOT cited to a specific PFM Act section number, because that could not be independently confirmed at the time this registry was written — asserting a precise section citation without verifying it would be worse than citing the general principle honestly.',
    description:
      'No single official can both request and approve the same transaction, or both approve and execute the same payment. Enforced structurally through role/permission grants (e.g. `payment:approve` and `payment:execute` are different roles; a Procurement Officer never holds `risk:review`), not just procedurally.',
    enforcement: 'preventive',
    enforcedBy:
      'packages/database/prisma/seed.ts (ROLE_PERMISSIONS — the actual grant boundaries) and apps/api/src/modules/contracts/ (multi-signature payment approval, Phase 9)',
  },
  {
    id: 'public-accountability-scorecards',
    title: "Named officials' track records are public",
    citation:
      'Constitution of Kenya, 2010, Article 227(1) (the same fair/transparent/accountable procurement principle cited above) — this rule is the policy CHOICE of how far that principle extends, not a separate legal citation.',
    verifiedAgainst:
      'N/A — a disclosure-scope decision, not a citation. Explicitly asked of the user rather than assumed: the recommended default was "internal only" (visible to Auditor/Internal Auditor roles, preserving the Phase 12 "no individual civil-servant identity, anywhere" boundary), and "public, org-level aggregates only, names internal" was offered as a middle option. The user explicitly chose full public disclosure with names over both.',
    description:
      'Every official who has approved a budget, approved a procurement request, made a tender award, verified an invoice, approved a payment, or conducted a project inspection has a public scorecard (GET /public/accountability/officials) showing real counts/amounts per category, vendor-award diversity, and a risk-flagged-action rate — computed live from the same underlying data every other module already writes, never a separate self-reported figure. Still deliberately excluded even having chosen public+named: email/phone, and the CONTENT of any specific risk alert (only the aggregate flagged count/rate) — the identity question and the operational-security-of-live-investigations question are separate, and only the first was reopened here.',
    enforcement: 'transparency',
    enforcedBy:
      'apps/api/src/modules/accountability/ (AccountabilityService, public GET /public/accountability/officials and /officials/:id)',
  },
  {
    id: 'step-up-mfa-on-sensitive-actions',
    title:
      'Fresh re-authentication required for the most consequential actions',
    citation:
      "General internal-control principle underlying the Public Finance Management Act, 2012's financial-control framework, same basis as separation-of-duties above — not tied to a single specific section here.",
    verifiedAgainst:
      'Deliberately NOT cited to a specific PFM Act section number, for the same reason as separation-of-duties above: asserting a precise citation without independently verifying it would be worse than citing the general control principle honestly.',
    description:
      "Login-time MFA alone only defends the moment a session begins — a hijacked or stolen access token can otherwise be replayed for its whole lifetime. Executing a payment (payment:execute) and changing another user's role/status (users:update, a privilege-escalation vector) additionally require a FRESH TOTP/backup code, obtained via POST /auth/step-up, within the preceding STEP_UP_TOKEN_TTL_SECONDS (default 10 minutes). Budget approval is deliberately not re-wired here — it already carries the stronger per-official digital-signature requirement (see the Digital Signatures entry in SECURITY.md), which subsumes this guarantee for that one action.",
    enforcement: 'preventive',
    enforcedBy:
      'apps/api/src/modules/iam/guards/step-up.guard.ts (StepUpGuard, global APP_GUARD, no-op unless a route carries @RequireStepUp()) — wired onto PaymentRequestsController.execute() and UsersController.update()',
  },
  {
    id: 'gps-tagged-evidence-capture',
    title: 'Flag project evidence captured far from the declared site',
    citation:
      'Constitution of Kenya, 2010, Article 227(1) (fair, transparent, competitive, cost-effective use of public resources) and the general public financial control principle underlying the Public Finance Management Act, 2012 — physical verification that public works are actually executed where and as claimed is a precondition for either.',
    verifiedAgainst:
      'N/A — a detection heuristic built on client-supplied GPS metadata, not a citation of a specific legal provision.',
    description:
      "Project evidence (POST /projects/:id/evidence) may optionally carry the capturing device's GPS coordinates and capture timestamp, preserved immutably alongside the file. A project may separately declare its own site coordinates at creation. When both are present and disagree by more than RISK_EVIDENCE_LOCATION_MISMATCH_METERS (default 500m, haversine distance), a risk alert is raised — MEDIUM, or HIGH beyond 10x that margin — flagging evidence that could not plausibly have been captured at the claimed site (a stock photo, evidence recycled from a different project, or a fabricated inspection). Neither GPS field is required: most evidence (scanned documents, older uploads) will have neither and that alone is not suspicious. Upload is never blocked on a location mismatch, only flagged for human review.",
    enforcement: 'detective',
    enforcedBy:
      'apps/api/src/modules/risk/services/evidence-location.detector.ts (EvidenceLocationDetector.evaluateEvidence, called after every evidence upload)',
  },
  {
    id: 'live-market-price-verification',
    title:
      "Flag a tender lot's estimate deviating from an independent market reference price",
    citation:
      'Constitution of Kenya, 2010, Article 227(1) (fair, competitive, cost-effective use of public resources) — a procuring entity paying materially more than the real market rate, whether through an inflated estimate or coordinated bidder pricing, is the opposite of cost-effective use.',
    verifiedAgainst:
      'N/A — a detection heuristic, not a citation of a specific legal provision.',
    description:
      "Complements the peer-bid statistical check (price-anomaly, Phase 8) with an orthogonal signal it structurally cannot produce: the peer check can only flag a bid that stands out AMONG a lot's own bidders, so it is blind to every bidder colluding on similarly inflated prices. This check instead compares the lot's own pre-tender estimate against an independent market reference price (MarketDataAdapter), raised as MEDIUM (or HIGH beyond 2x) when they diverge by more than RISK_MARKET_PRICE_DEVIATION_THRESHOLD (default 30%). Runs on every tender close. In THIS deployment the check never actually fires — the default LogOnlyMarketDataAdapter always returns no data, since no real market-data provider account exists (see SECURITY.md § Push Notifications & Live Market-Data Pricing for why) — but the detector, alert type, and audit trail are fully wired and tested, ready to activate the moment a real provider is configured.",
    enforcement: 'detective',
    enforcedBy:
      'apps/api/src/modules/risk/services/price-anomaly.detector.ts (PriceAnomalyDetector.evaluateMarketPriceDeviation, called on every tender-lot evaluation)',
  },
];
