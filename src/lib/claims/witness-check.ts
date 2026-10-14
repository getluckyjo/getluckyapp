/**
 * The witness rules for the claim screen, without zod.
 *
 * The server validates with WitnessSchema (src/lib/claims/witnesses.ts);
 * the phone needs the same answer to enable Submit, and importing the
 * schema pulled zod's whole bundle into a screen that is opened on a golf
 * course. This is the same rule written by hand, and the test runs both
 * over the same fixtures so they cannot drift.
 */
import type { WitnessInput } from './witnesses'

export type WitnessDraft = { role: 'witness' | 'club_official'; name: string; email: string }

/** Close enough to zod's email check for a form: one @, a dot in the domain, no spaces. */
const EMAIL = /^(?!\.)(?!.*\.\.)[A-Za-z0-9_'+\-.]*[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/

export type WitnessCheck = { ok: true; data: WitnessInput } | { ok: false }

export function checkWitness(w: WitnessDraft): WitnessCheck {
  if (w.role !== 'witness' && w.role !== 'club_official') return { ok: false }
  const name = String(w.name ?? '').trim()
  if (name.length < 2 || name.length > 80) return { ok: false }
  const email = String(w.email ?? '').trim().toLowerCase()
  if (email.length === 0 || email.length > 200 || !EMAIL.test(email)) return { ok: false }
  return { ok: true, data: { role: w.role, name, email } }
}
