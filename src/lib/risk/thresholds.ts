/**
 * Every number the risk rules use, in one place. Change these, not the
 * rules. Starting values agreed in docs/stage-4-proposal.md §1.5.
 */
export const THRESHOLDS = {
  /** repeat_claimant: another claim by this account within this many days. */
  repeatClaimWindowDays: 365,
  /** first_bet_win: account younger than this at the time of the bet. */
  newAccountHours: 48,
  /** shared_ip: another account from the same address within this many days. */
  sharedIpWindowDays: 30,
  /** upload_lag: seconds between recording end and the footage being sealed. */
  uploadLagMaxSeconds: 15 * 60,
  /** upload_lag: hours between bet creation and the footage being sealed. */
  uploadAfterBetMaxHours: 12,
  /** far_from_course: metres from the course's coordinates. */
  farFromCourseMetres: 2_000,
  /** hole_cluster: this many claims at one hole within the window. */
  holeClusterCount: 3,
  holeClusterWindowDays: 7,
} as const

export type Severity = 'low' | 'medium' | 'high'

export const SEVERITY_SCORE: Record<Severity, number> = { low: 1, medium: 2, high: 3 }
