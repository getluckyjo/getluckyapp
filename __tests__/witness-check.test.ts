/**
 * The hand-written witness check on the claim screen and the zod schema on
 * the server agree on every fixture, so the Submit button never lets
 * through what the server refuses, or holds back what it would take.
 */
import { describe, it, expect } from 'vitest'
import { WitnessSchema } from '@/lib/claims/witnesses'
import { checkWitness } from '@/lib/claims/witness-check'

const FIXTURES: { role: string; name: string; email: string }[] = [
  { role: 'witness', name: 'Sipho Dlamini', email: 'sipho@example.com' },
  { role: 'club_official', name: '  Thandi Nkosi ', email: 'Thandi.Nkosi@Club.co.za' },
  { role: 'witness', name: 'Jo', email: 'jo@x.io' },
  { role: 'witness', name: 'J', email: 'j@example.com' },
  { role: 'witness', name: 'x'.repeat(81), email: 'long@example.com' },
  { role: 'witness', name: 'No Email', email: '' },
  { role: 'witness', name: 'Bad Email', email: 'not-an-email' },
  { role: 'witness', name: 'Space', email: 'a b@example.com' },
  { role: 'witness', name: 'No TLD', email: 'a@localhost' },
  { role: 'witness', name: 'Double Dot', email: 'a..b@example.com' },
  { role: 'witness', name: 'Plus', email: 'a+tag@example.com' },
  { role: 'witness', name: 'Sub', email: 'a@mail.example.co.za' },
  { role: 'caddie', name: 'Wrong Role', email: 'c@example.com' },
  { role: 'witness', name: '', email: 'blank@example.com' },
  { role: 'witness', name: 'Too Long', email: `${'a'.repeat(190)}@example.com` },
]

describe('checkWitness mirrors WitnessSchema', () => {
  for (const f of FIXTURES) {
    it(`${f.role} / ${f.name.slice(0, 12)} / ${f.email.slice(0, 20)}`, () => {
      const zod = WitnessSchema.safeParse(f)
      const ours = checkWitness(f as never)
      expect(ours.ok).toBe(zod.success)
      if (zod.success && ours.ok) expect(ours.data).toEqual(zod.data)
    })
  }
})
