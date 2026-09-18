/**
 * Algorithm parameters for the statistical detectors — these are properties
 * of the statistics themselves (what counts as an outlier, what counts as
 * suspiciously uniform), not deployment policy, so they're plain constants
 * rather than env-configurable like the split-procurement thresholds (see
 * env.validation.ts).
 */

/** A bid's |z-score| against its lot's peer bids at or above this is an outlier. */
export const PRICE_ANOMALY_Z_SCORE_MEDIUM = 2;
export const PRICE_ANOMALY_Z_SCORE_HIGH = 3;

/**
 * Minimum TOTAL bids on a lot before leave-one-out z-score statistics are
 * meaningful — each bid is scored against its (n-1) peers, so this must be
 * at least 4, not 3: with exactly 3 total bids, leave-one-out always leaves
 * only 2 peers, and any 3-point set that's even roughly evenly spaced
 * produces a leave-one-out z-score of exactly ±3.0 for its two extreme
 * points **regardless of how tight or wide the actual spread is** — a pure
 * artifact of 2-point variance, not a real anomaly signal. Caught
 * empirically during Phase 8 manual smoke testing (three genuinely
 * ordinary, evenly-spaced bids both correctly triggered bid-collusion and
 * incorrectly triggered price-anomaly on the same data) and fixed by
 * requiring at least 3 peers (4 total bids) before trusting the statistic.
 */
export const PRICE_ANOMALY_MIN_BIDS_FOR_ZSCORE = 4;

/** With fewer bids, fall back to flagging deviation from the lot's own estimate. */
export const PRICE_ANOMALY_ESTIMATE_DEVIATION_THRESHOLD = 0.5;

/** Minimum bids on a lot before "suspiciously uniform pricing" is meaningful. */
export const BID_COLLUSION_MIN_BIDS = 3;

/** Coefficient of variation (stddev/mean) below this is suspiciously tight. */
export const BID_COLLUSION_CV_HIGH = 0.02;
export const BID_COLLUSION_CV_MEDIUM = 0.05;

/** Weighted contribution of each supplier-risk signal, summed and clamped to [0, 100]. */
export const SUPPLIER_RISK_WEIGHTS = {
  politicallyExposedOwner: 40,
  rejectedDocument: 15,
  expiredVerifiedDocument: 10,
  suspended: 20,
  blacklisted: 50,
} as const;

export const SUPPLIER_RISK_LEVEL_THRESHOLDS = {
  MEDIUM: 25,
  HIGH: 50,
  CRITICAL: 75,
} as const;
