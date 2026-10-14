/**
 * What the golfer has typed and uploaded on the claim screen, kept on the
 * phone until the claim is submitted.
 *
 * A claim is filled in on the course after a hole-in-one, with a tour of
 * the clubhouse in between: the app is backgrounded, the tab is dropped,
 * the phone locks. Without this the certificate had to be photographed
 * again and the witnesses typed again. The draft is per bet, in
 * localStorage, and gone the moment the claim is in.
 */
export interface ClaimDraft {
  witnesses: { role: 'witness' | 'club_official'; name: string; email: string }[]
  documents: Record<string, { storagePath: string; fileName: string }>
  savedAt: number
}

const PREFIX = 'glg:claim-draft:'
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export function readClaimDraft(betId: string): ClaimDraft | null {
  try {
    const raw = localStorage.getItem(PREFIX + betId)
    if (!raw) return null
    const draft = JSON.parse(raw) as ClaimDraft
    if (!draft || typeof draft.savedAt !== 'number' || Date.now() - draft.savedAt > MAX_AGE_MS) return null
    return { witnesses: Array.isArray(draft.witnesses) ? draft.witnesses : [], documents: draft.documents ?? {}, savedAt: draft.savedAt }
  } catch { return null }
}

export function writeClaimDraft(betId: string, draft: Omit<ClaimDraft, 'savedAt'>): void {
  try { localStorage.setItem(PREFIX + betId, JSON.stringify({ ...draft, savedAt: Date.now() })) } catch { /* storage full or blocked */ }
}

export function clearClaimDraft(betId: string): void {
  try { localStorage.removeItem(PREFIX + betId) } catch { /* nothing kept */ }
}
