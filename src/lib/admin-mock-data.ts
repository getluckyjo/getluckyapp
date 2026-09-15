import type {
  AdminStats,
  AdminBetRecord,
  AdminUserRecord,
  AdminCourseRecord,
  VerificationQueueItem,
  VerificationDetail,
} from '@/types/admin'

// ── Mock Users ──
export const MOCK_ADMIN_USERS: AdminUserRecord[] = [
  { id: 'u1', name: 'Thabo Molefe', email: 'thabo@email.co.za', handicap: 12, totalAttempts: 24, totalStaked: 240000, totalWon: 0, paymentMethod: 'card', isAdmin: false, suspendedAt: null, suspendedReason: null, createdAt: '2025-11-15T08:00:00Z' },
  { id: 'u2', name: 'Lerato Nkosi', email: 'lerato@email.co.za', handicap: 8, totalAttempts: 52, totalStaked: 520000, totalWon: 6000000, paymentMethod: 'eft', isAdmin: false, suspendedAt: null, suspendedReason: null, createdAt: '2025-10-02T10:30:00Z' },
  { id: 'u3', name: 'Pieter van Wyk', email: 'pieter@email.co.za', handicap: 18, totalAttempts: 8, totalStaked: 80000, totalWon: 0, paymentMethod: 'apple_pay', isAdmin: false, suspendedAt: null, suspendedReason: null, createdAt: '2026-01-20T14:00:00Z' },
  { id: 'u4', name: 'Naledi Dlamini', email: 'naledi@email.co.za', handicap: 5, totalAttempts: 67, totalStaked: 1675000, totalWon: 20000000, paymentMethod: 'card', isAdmin: false, suspendedAt: null, suspendedReason: null, createdAt: '2025-09-10T07:15:00Z' },
  { id: 'u5', name: 'James Mitchell', email: 'james@email.co.za', handicap: 15, totalAttempts: 3, totalStaked: 30000, totalWon: 0, paymentMethod: 'google_pay', isAdmin: false, suspendedAt: null, suspendedReason: null, createdAt: '2026-02-28T16:45:00Z' },
  { id: 'u6', name: 'Sipho Mabaso', email: 'sipho@email.co.za', handicap: 10, totalAttempts: 41, totalStaked: 1025000, totalWon: 2500000, paymentMethod: 'eft', isAdmin: false, suspendedAt: null, suspendedReason: null, createdAt: '2025-12-01T09:00:00Z' },
  { id: 'u7', name: 'Annika Botha', email: 'annika@email.co.za', handicap: 22, totalAttempts: 15, totalStaked: 150000, totalWon: 0, paymentMethod: 'card', isAdmin: false, suspendedAt: null, suspendedReason: null, createdAt: '2026-01-05T11:30:00Z' },
  { id: 'u8', name: 'David Chen', email: 'david@email.co.za', handicap: 6, totalAttempts: 89, totalStaked: 4450000, totalWon: 50000000, paymentMethod: 'card', isAdmin: false, suspendedAt: null, suspendedReason: null, createdAt: '2025-08-15T06:00:00Z' },
  { id: 'u9', name: 'Fatima Patel', email: 'fatima@email.co.za', handicap: 14, totalAttempts: 19, totalStaked: 190000, totalWon: 0, paymentMethod: 'apple_pay', isAdmin: false, suspendedAt: '2026-02-14T12:00:00Z', suspendedReason: 'Suspicious activity', createdAt: '2025-11-30T13:00:00Z' },
  { id: 'u10', name: 'Ruan Swanepoel', email: 'ruan@email.co.za', handicap: 9, totalAttempts: 33, totalStaked: 825000, totalWon: 0, paymentMethod: 'eft', isAdmin: false, suspendedAt: null, suspendedReason: null, createdAt: '2025-10-18T15:20:00Z' },
]

// ── Mock Bets ──
export const MOCK_ADMIN_BETS: AdminBetRecord[] = [
  { id: 'b1', userId: 'u1', userName: 'Thabo Molefe', tier: 'tier_2', stakeCents: 10000, potentialWinCents: 6000000, status: 'active', declaredResult: null, declaredAt: null, videoUrl: null, paymentIntentId: 'pf_001', courseName: 'Leopard Creek', courseId: 'c1', holeNumber: 4, holeId: 'h1', createdAt: '2026-03-10T09:30:00Z' },
  { id: 'b2', userId: 'u2', userName: 'Lerato Nkosi', tier: 'tier_3', stakeCents: 25000, potentialWinCents: 20000000, status: 'claimed', declaredResult: 'win', declaredAt: '2026-03-09T14:22:00Z', videoUrl: 'u2/b2/shot.webm', paymentIntentId: 'pf_002', courseName: 'Fancourt', courseId: 'c2', holeNumber: 7, holeId: 'h2', createdAt: '2026-03-09T12:00:00Z' },
  { id: 'b3', userId: 'u4', userName: 'Naledi Dlamini', tier: 'tier_4', stakeCents: 50000, potentialWinCents: 50000000, status: 'claimed', declaredResult: 'win', declaredAt: '2026-03-08T16:45:00Z', videoUrl: 'u4/b3/shot.webm', paymentIntentId: 'pf_003', courseName: 'Pearl Valley', courseId: 'c3', holeNumber: 12, holeId: 'h3', createdAt: '2026-03-08T14:00:00Z' },
  { id: 'b4', userId: 'u3', userName: 'Pieter van Wyk', tier: 'tier_1', stakeCents: 5000, potentialWinCents: 2500000, status: 'miss', declaredResult: 'miss', declaredAt: '2026-03-10T11:00:00Z', videoUrl: 'u3/b4/shot.webm', paymentIntentId: 'pf_004', courseName: 'Steenberg', courseId: 'c4', holeNumber: 3, holeId: 'h4', createdAt: '2026-03-10T10:00:00Z' },
  { id: 'b5', userId: 'u6', userName: 'Sipho Mabaso', tier: 'tier_2', stakeCents: 10000, potentialWinCents: 6000000, status: 'verified', declaredResult: 'win', declaredAt: '2026-03-05T10:30:00Z', videoUrl: 'u6/b5/shot.webm', paymentIntentId: 'pf_005', courseName: 'Sun City', courseId: 'c5', holeNumber: 8, holeId: 'h5', createdAt: '2026-03-05T08:00:00Z' },
  { id: 'b6', userId: 'u8', userName: 'David Chen', tier: 'tier_5', stakeCents: 100000, potentialWinCents: 100000000, status: 'claimed', declaredResult: 'win', declaredAt: '2026-03-07T09:15:00Z', videoUrl: 'u8/b6/shot.webm', paymentIntentId: 'pf_006', courseName: 'Zimbali', courseId: 'c6', holeNumber: 15, holeId: 'h6', createdAt: '2026-03-07T07:00:00Z' },
  { id: 'b7', userId: 'u1', userName: 'Thabo Molefe', tier: 'tier_1', stakeCents: 5000, potentialWinCents: 2500000, status: 'miss', declaredResult: 'miss', declaredAt: '2026-03-06T15:00:00Z', videoUrl: 'u1/b7/shot.webm', paymentIntentId: 'pf_007', courseName: 'Serengeti Estates', courseId: 'c7', holeNumber: 5, holeId: 'h7', createdAt: '2026-03-06T13:30:00Z' },
  { id: 'b8', userId: 'u7', userName: 'Annika Botha', tier: 'tier_2', stakeCents: 10000, potentialWinCents: 6000000, status: 'active', declaredResult: null, declaredAt: null, videoUrl: null, paymentIntentId: 'pf_008', courseName: 'Atlantic Beach', courseId: 'c8', holeNumber: 11, holeId: 'h8', createdAt: '2026-03-10T07:45:00Z' },
  { id: 'b9', userId: 'u10', userName: 'Ruan Swanepoel', tier: 'tier_3', stakeCents: 25000, potentialWinCents: 20000000, status: 'miss', declaredResult: 'miss', declaredAt: '2026-03-09T17:00:00Z', videoUrl: 'u10/b9/shot.webm', paymentIntentId: 'pf_009', courseName: 'Boschenmeer', courseId: 'c9', holeNumber: 6, holeId: 'h9', createdAt: '2026-03-09T15:00:00Z' },
  { id: 'b10', userId: 'u5', userName: 'James Mitchell', tier: 'tier_1', stakeCents: 5000, potentialWinCents: 2500000, status: 'active', declaredResult: null, declaredAt: null, videoUrl: null, paymentIntentId: 'pf_010', courseName: 'Erinvale', courseId: 'c10', holeNumber: 9, holeId: 'h10', createdAt: '2026-03-10T12:15:00Z' },
  { id: 'b11', userId: 'u2', userName: 'Lerato Nkosi', tier: 'tier_2', stakeCents: 10000, potentialWinCents: 6000000, status: 'paid', declaredResult: 'win', declaredAt: '2026-02-20T14:00:00Z', videoUrl: 'u2/b11/shot.webm', paymentIntentId: 'pf_011', courseName: 'Leopard Creek', courseId: 'c1', holeNumber: 4, holeId: 'h1', createdAt: '2026-02-20T10:00:00Z' },
  { id: 'b12', userId: 'u8', userName: 'David Chen', tier: 'tier_4', stakeCents: 50000, potentialWinCents: 50000000, status: 'paid', declaredResult: 'win', declaredAt: '2026-02-10T09:30:00Z', videoUrl: 'u8/b12/shot.webm', paymentIntentId: 'pf_012', courseName: 'Fancourt', courseId: 'c2', holeNumber: 7, holeId: 'h2', createdAt: '2026-02-10T07:00:00Z' },
]

// ── Mock Verifications ──
export const MOCK_ADMIN_VERIFICATIONS: VerificationQueueItem[] = [
  { id: 'v1', betId: 'b2', status: 'documents_received', tier: 'tier_3', stakeCents: 25000, potentialWinCents: 20000000, videoUrl: 'u2/b2/shot.webm', certificatePath: 'u2/b2/certificate.pdf', affidavitPath: 'u2/b2/affidavit.pdf', userName: 'Lerato Nkosi', userId: 'u2', courseName: 'Fancourt', holeNumber: 7, createdAt: '2026-03-09T14:30:00Z', declaredAt: '2026-03-09T14:22:00Z', documentsReceivedAt: '2026-03-09T15:00:00Z', reviewerNotes: null, reviewedBy: null, verifiedAt: null, payoutInitiatedAt: null },
  { id: 'v2', betId: 'b3', status: 'under_review', tier: 'tier_4', stakeCents: 50000, potentialWinCents: 50000000, videoUrl: 'u4/b3/shot.webm', certificatePath: 'u4/b3/certificate.pdf', affidavitPath: 'u4/b3/affidavit.pdf', userName: 'Naledi Dlamini', userId: 'u4', courseName: 'Pearl Valley', holeNumber: 12, createdAt: '2026-03-08T17:00:00Z', declaredAt: '2026-03-08T16:45:00Z', documentsReceivedAt: '2026-03-08T18:00:00Z', reviewerNotes: 'Video quality good, checking certificate authenticity', reviewedBy: null, verifiedAt: null, payoutInitiatedAt: null },
  { id: 'v3', betId: 'b6', status: 'pending', tier: 'tier_5', stakeCents: 100000, potentialWinCents: 100000000, videoUrl: 'u8/b6/shot.webm', certificatePath: null, affidavitPath: null, userName: 'David Chen', userId: 'u8', courseName: 'Zimbali', holeNumber: 15, createdAt: '2026-03-07T09:20:00Z', declaredAt: '2026-03-07T09:15:00Z', documentsReceivedAt: null, reviewerNotes: null, reviewedBy: null, verifiedAt: null, payoutInitiatedAt: null },
  { id: 'v4', betId: 'b5', status: 'approved', tier: 'tier_2', stakeCents: 10000, potentialWinCents: 6000000, videoUrl: 'u6/b5/shot.webm', certificatePath: 'u6/b5/certificate.pdf', affidavitPath: 'u6/b5/affidavit.pdf', userName: 'Sipho Mabaso', userId: 'u6', courseName: 'Sun City', holeNumber: 8, createdAt: '2026-03-05T10:45:00Z', declaredAt: '2026-03-05T10:30:00Z', documentsReceivedAt: '2026-03-05T12:00:00Z', reviewerNotes: 'All documents verified. Clean hole-in-one on camera.', reviewedBy: 'mock-admin-user', verifiedAt: '2026-03-06T09:00:00Z', payoutInitiatedAt: '2026-03-06T10:00:00Z' },
  { id: 'v5', betId: 'b11', status: 'approved', tier: 'tier_2', stakeCents: 10000, potentialWinCents: 6000000, videoUrl: 'u2/b11/shot.webm', certificatePath: 'u2/b11/certificate.pdf', affidavitPath: 'u2/b11/affidavit.pdf', userName: 'Lerato Nkosi', userId: 'u2', courseName: 'Leopard Creek', holeNumber: 4, createdAt: '2026-02-20T14:15:00Z', declaredAt: '2026-02-20T14:00:00Z', documentsReceivedAt: '2026-02-20T16:00:00Z', reviewerNotes: 'Verified by course pro shop.', reviewedBy: 'mock-admin-user', verifiedAt: '2026-02-21T10:00:00Z', payoutInitiatedAt: '2026-02-21T11:00:00Z' },
]

// ── Mock Verification Detail ──
export function getMockVerificationDetail(id: string): VerificationDetail | null {
  const item = MOCK_ADMIN_VERIFICATIONS.find(v => v.id === id)
  if (!item) return null
  return {
    ...item,
    videoSignedUrl: item.videoUrl ? `https://placeholder.supabase.co/storage/v1/object/sign/shot-videos/${item.videoUrl}` : null,
    certificateSignedUrl: item.certificatePath ? `https://placeholder.supabase.co/storage/v1/object/sign/verification-docs/${item.certificatePath}` : null,
    affidavitSignedUrl: item.affidavitPath ? `https://placeholder.supabase.co/storage/v1/object/sign/verification-docs/${item.affidavitPath}` : null,
    userBetHistory: MOCK_ADMIN_BETS.filter(b => b.userId === item.userId).slice(0, 5),
    userTotalAttempts: MOCK_ADMIN_USERS.find(u => u.id === item.userId)?.totalAttempts ?? 0,
  }
}

// ── Mock Courses ──
export const MOCK_ADMIN_COURSES: AdminCourseRecord[] = [
  { id: 'c1', name: 'Leopard Creek', location_text: 'Mpumalanga', region: 'Mpumalanga', country: 'South Africa', lat: -25.38, lng: 31.58, is_partner: true, image_url: null, created_at: '2025-06-01T00:00:00Z', holeCount: 3, activeHoleCount: 3, totalBets: 156 },
  { id: 'c2', name: 'Fancourt', location_text: 'George, Western Cape', region: 'Western Cape', country: 'South Africa', lat: -33.96, lng: 22.38, is_partner: true, image_url: null, created_at: '2025-06-01T00:00:00Z', holeCount: 4, activeHoleCount: 4, totalBets: 234 },
  { id: 'c3', name: 'Pearl Valley', location_text: 'Franschhoek, Western Cape', region: 'Western Cape', country: 'South Africa', lat: -33.83, lng: 19.08, is_partner: false, image_url: null, created_at: '2025-07-15T00:00:00Z', holeCount: 3, activeHoleCount: 2, totalBets: 89 },
  { id: 'c4', name: 'Steenberg', location_text: 'Constantia, Cape Town', region: 'Western Cape', country: 'South Africa', lat: -34.06, lng: 18.46, is_partner: true, image_url: null, created_at: '2025-06-01T00:00:00Z', holeCount: 2, activeHoleCount: 2, totalBets: 112 },
  { id: 'c5', name: 'Sun City', location_text: 'North West', region: 'North West', country: 'South Africa', lat: -25.34, lng: 27.09, is_partner: true, image_url: null, created_at: '2025-06-01T00:00:00Z', holeCount: 3, activeHoleCount: 3, totalBets: 198 },
  { id: 'c6', name: 'Zimbali', location_text: 'Ballito, KZN', region: 'KwaZulu-Natal', country: 'South Africa', lat: -29.45, lng: 31.24, is_partner: false, image_url: null, created_at: '2025-08-20T00:00:00Z', holeCount: 2, activeHoleCount: 2, totalBets: 67 },
  { id: 'c7', name: 'Serengeti Estates', location_text: 'Kempton Park, Gauteng', region: 'Gauteng', country: 'South Africa', lat: -26.07, lng: 28.26, is_partner: false, image_url: null, created_at: '2025-09-10T00:00:00Z', holeCount: 3, activeHoleCount: 3, totalBets: 145 },
  { id: 'c8', name: 'Atlantic Beach', location_text: 'Melkbosstrand, Cape Town', region: 'Western Cape', country: 'South Africa', lat: -33.72, lng: 18.47, is_partner: true, image_url: null, created_at: '2025-06-01T00:00:00Z', holeCount: 2, activeHoleCount: 2, totalBets: 76 },
  { id: 'c9', name: 'Boschenmeer', location_text: 'Paarl, Western Cape', region: 'Western Cape', country: 'South Africa', lat: -33.78, lng: 18.97, is_partner: false, image_url: null, created_at: '2025-10-05T00:00:00Z', holeCount: 3, activeHoleCount: 2, totalBets: 54 },
  { id: 'c10', name: 'Erinvale', location_text: 'Somerset West, Cape Town', region: 'Western Cape', country: 'South Africa', lat: -34.06, lng: 18.88, is_partner: true, image_url: null, created_at: '2025-06-01T00:00:00Z', holeCount: 2, activeHoleCount: 2, totalBets: 91 },
]

// ── Mock Stats ──
export const MOCK_ADMIN_STATS: AdminStats = {
  totalRevenue: 8190000, // R81,900 in cents
  activeBets: 3,
  pendingClaims: 3,
  totalPayouts: 56000000, // R560,000 in cents
  totalUsers: MOCK_ADMIN_USERS.length,
  recentBets: MOCK_ADMIN_BETS.slice(0, 5),
  recentVerifications: MOCK_ADMIN_VERIFICATIONS.slice(0, 3),
}

// ── Helper: format cents to ZAR ──
export function formatZAR(cents: number): string {
  return `R${(cents / 100).toLocaleString('en-ZA', { minimumFractionDigits: 0 })}`
}

// ── Helper: relative time ──
export function timeAgo(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diffMs = now - then
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })
}
