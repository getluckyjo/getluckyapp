import type { Database } from './database'
import type { BetTier } from '@/lib/tiers'

export type { BetTier }
export type BetRow = Database['public']['Tables']['bets']['Row']
export type ProfileRow = Database['public']['Tables']['profiles']['Row']
export type CourseRow = Database['public']['Tables']['courses']['Row']
export type HoleRow = Database['public']['Tables']['holes']['Row']
export type VerificationRow = Database['public']['Tables']['verifications']['Row']
export type VerificationStatus = VerificationRow['status']
export type BetStatus = BetRow['status']

export interface AdminStats {
  totalRevenue: number
  activeBets: number
  pendingClaims: number
  totalPayouts: number
  totalUsers: number
  recentBets: AdminBetRecord[]
  recentVerifications: VerificationQueueItem[]
}

export interface VerificationQueueItem {
  id: string
  betId: string
  status: VerificationStatus
  tier: BetTier
  stakeCents: number
  potentialWinCents: number
  videoUrl: string | null
  certificatePath: string | null
  affidavitPath: string | null
  userName: string | null
  userId: string
  courseName: string
  holeNumber: number
  createdAt: string
  declaredAt: string | null
  documentsReceivedAt: string | null
  reviewerNotes: string | null
  reviewedBy: string | null
  verifiedAt: string | null
  payoutInitiatedAt: string | null
}

export interface ClaimEvent {
  id: number
  table_name: 'bets' | 'verifications'
  action: 'insert' | 'update'
  actor_id: string | null
  actor_role: string
  changed: Record<string, { from: unknown; to: unknown }> | null
  created_at: string
}

export interface CaptureAttestation {
  startedAt: string | null
  endedAt: string | null
  durationMs: number | null
  lat: number | null
  lng: number | null
  accuracyM: number | null
  /** Metres from the reported position to the course; null when either is unknown. */
  distanceM: number | null
  userAgent: string | null
  /** Seconds between recording end and the server sealing the footage; null when either is unknown. */
  uploadLagS: number | null
}

export interface ClaimWitness {
  id: string
  role: 'witness' | 'club_official'
  name: string
  email: string
  createdAt: string
}

export interface DocumentSealInfo { sha256: string | null; bytes: number | null }

export interface VerificationDetail extends VerificationQueueItem {
  videoSignedUrl: string | null
  certificateSignedUrl: string | null
  affidavitSignedUrl: string | null
  capture: CaptureAttestation
  certificateSeal: DocumentSealInfo
  affidavitSeal: DocumentSealInfo
  witnesses: ClaimWitness[]
  userBetHistory: AdminBetRecord[]
  userTotalAttempts: number
  betStatus: BetStatus | null
  betCreatedAt: string | null
  betExpiresAt: string | null
  videoSha256: string | null
  videoBytes: number | null
  videoUploadedAt: string | null
  events: ClaimEvent[]
}

export interface AdminBetRecord {
  id: string
  userId: string
  userName: string | null
  tier: BetTier
  stakeCents: number
  potentialWinCents: number
  status: BetStatus
  declaredResult: 'miss' | 'win' | null
  declaredAt: string | null
  videoUrl: string | null
  paymentIntentId: string | null
  courseName: string
  courseId: string
  holeNumber: number
  holeId: string
  createdAt: string
}

export interface AdminUserRecord {
  id: string
  name: string | null
  email: string
  handicap: number | null
  totalAttempts: number
  totalStaked: number
  totalWon: number
  paymentMethod: string | null
  isAdmin: boolean
  suspendedAt: string | null
  suspendedReason: string | null
  createdAt: string
}

export interface AdminCourseRecord extends CourseRow {
  holeCount: number
  activeHoleCount: number
  totalBets: number
}

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export interface BatchActionResult {
  id: string
  success: boolean
  error?: string
}
