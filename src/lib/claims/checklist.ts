/**
 * What a reviewer confirms before approving a claim. Stored on the
 * verification (and so in the audit log) with who and when. Client-safe.
 */
import { z } from 'zod'

export const REVIEW_CHECKLIST = [
  { key: 'footage_watched',       label: 'I watched the footage to the end' },
  { key: 'ball_in_hole',          label: 'I saw the ball enter the hole' },
  { key: 'hole_matches',          label: 'The hole and course in the footage match the bet' },
  { key: 'timeline_consistent',   label: 'Recording, upload and bet times make sense together' },
  { key: 'certificate_confirmed', label: 'I confirmed the certificate with the club (say how and with whom in the notes)' },
  { key: 'affidavit_matches',     label: 'The affidavit names match the witnesses named' },
  { key: 'flags_reviewed',        label: 'I read every risk flag and addressed each in the notes' },
] as const

export type ChecklistKey = (typeof REVIEW_CHECKLIST)[number]['key']

export const ChecklistSchema = z.object(
  Object.fromEntries(REVIEW_CHECKLIST.map(i => [i.key, z.literal(true)])) as Record<ChecklistKey, z.ZodLiteral<true>>,
)

/** Notes are required on approve and reject: the reason is part of the record. */
export const MIN_DECISION_NOTES = 10
