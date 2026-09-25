/**
 * What the claim review screens and their API share beyond VerificationDetail
 * (@/types/admin). Client-safe: types and constants only.
 */
import type { VerificationDetail, VerificationStatus } from '@/types/admin'

/** Claims still waiting on a reviewer. The queue opens on these. */
export const OPEN_REVIEW_STATUSES = ['pending', 'documents_received', 'under_review'] as const satisfies readonly VerificationStatus[]

/**
 * Queue filters that are not one verification status. `open`: waiting on a
 * reviewer. `awaiting_payout`: approved, and the prize not yet recorded as
 * paid (the bet is verified), so paying it is the next action.
 */
export const QUEUE_STAGES = ['open', 'awaiting_payout'] as const
export type QueueStage = (typeof QUEUE_STAGES)[number]

export type ReviewMedia = 'video' | 'certificate' | 'affidavit'

/** GET /api/admin/verifications/[id]: the claim, and everything a reviewer must know before paying out. */
export interface VerificationReview extends VerificationDetail {
  /** How to reach the player, and anything about them that stops a payout. */
  player: {
    email: string | null
    suspendedAt: string | null
    suspendedReason: string | null
    ageVerifiedAt: string | null
  }
  /** The payment that bought the swing; null for a free swing (no stake). `missing`: no ledger row found. */
  payment: {
    status: 'complete' | 'amount_mismatch' | 'pending' | 'failed' | 'missing'
    amountCents: number | null
    reference: string | null
  } | null
  hole: { par: number | null; distanceMetres: number | null }
  /**
   * fresh: the rules ran for this request. stored: the bet's last result,
   * because the request asked for a quick reload (?fresh=0). failed: the
   * rules could not run, so this is the stored result.
   */
  riskCheck: 'fresh' | 'stored' | 'failed'
  riskEvaluatedAt: string | null
  /** Evidence that is on record but whose link could not be signed: not the same as never uploaded. */
  unsignedMedia: ReviewMedia[]
  /** Signed with `download`, so the browser saves the file instead of opening it (a cross-origin `download` attribute is ignored). */
  certificateDownloadUrl: string | null
  affidavitDownloadUrl: string | null
  /** Set when the footage was deleted under the retention policy. */
  footagePurgedAt: string | null
  /** When the links were signed. They last an hour. */
  signedAt: string
}
