/**
 * What each rule means, for the reviewer. Client-safe: no server imports.
 */
export type RiskRule =
  | 'repeat_claimant' | 'first_bet_win' | 'shared_ip' | 'shared_device' | 'upload_lag'
  | 'no_location' | 'far_from_course' | 'duplicate_media' | 'witness_overlap' | 'hole_cluster' | 'deleted_and_back'

export interface RiskFlag {
  rule: RiskRule
  severity: 'low' | 'medium' | 'high'
  /** Small, specific, and safe to show: counts, distances, ids. Never a hash or an email. */
  detail: Record<string, string | number | boolean | null>
}

export const RULE_LABELS: Record<RiskRule, { label: string; why: string }> = {
  repeat_claimant:  { label: 'Repeat claimant',           why: 'One hole-in-one is luck; two is a story that needs checking.' },
  first_bet_win:    { label: 'First bet, or new account',  why: 'Fresh accounts are how a scheme starts.' },
  shared_ip:        { label: 'Address shared with another account', why: 'One person, many accounts.' },
  shared_device:    { label: 'Device and address shared with another account', why: 'Same as above, stronger.' },
  upload_lag:       { label: 'Long gap before upload',     why: 'Room to substitute the footage.' },
  no_location:      { label: 'No location',                why: 'Cannot tell where the footage was recorded.' },
  far_from_course:  { label: 'Far from the course',        why: 'Footage was not recorded where the bet was placed.' },
  duplicate_media:  { label: 'Reused footage or document', why: 'The same file appears on another claim.' },
  witness_overlap:  { label: 'Witness is a player, or names appear on other claims', why: 'Friends signing for each other.' },
  hole_cluster:     { label: 'Several claims at this hole', why: 'A hole that suddenly pays out is worth a phone call.' },
  deleted_and_back: { label: 'Deleted an account before',  why: 'Deletion as a way to reset history.' },
}

export function describeFlag(flag: RiskFlag): string {
  const d = flag.detail
  switch (flag.rule) {
    case 'repeat_claimant':  return `${d.other_claims ?? 0} other claim(s) in the last year${d.rejected ? `, ${d.rejected} rejected` : ''}`
    case 'first_bet_win':    return d.first_bet ? 'This is the account\'s first bet' : `Account was ${d.account_age_hours} h old at the time of the bet`
    case 'shared_ip':        return `${d.accounts} other account(s) from the same address in ${d.window_days} days`
    case 'shared_device':    return `${d.accounts} other account(s) claimed from the same device and address`
    case 'upload_lag':       return d.after_recording_s != null ? `Sealed ${Math.round(Number(d.after_recording_s) / 60)} min after recording ended` : `Sealed ${d.after_bet_hours} h after the bet was placed`
    case 'no_location':      return 'The phone did not share a position'
    case 'far_from_course':  return `${(Number(d.distance_m) / 1000).toFixed(1)} km from the course`
    case 'duplicate_media':  return `${d.footage ? 'Footage' : 'A document'} matches ${d.matches} other claim(s)`
    case 'witness_overlap':  return [d.account_holders ? `${d.account_holders} witness(es) hold an account` : '', d.other_claims ? `named on ${d.other_claims} other claim(s)` : ''].filter(Boolean).join('; ')
    case 'hole_cluster':     return `${d.claims} claims at this hole in ${d.window_days} days`
    case 'deleted_and_back': return `A deleted account with this email had ${d.previous_bets} bet(s)`
  }
}
