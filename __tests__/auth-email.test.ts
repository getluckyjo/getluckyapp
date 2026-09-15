/**
 * Auth email pipeline: the Supabase Send Email hook's signature check and the
 * branded templates it renders.
 */
import { describe, it, expect } from 'vitest'
import { sign, verifyStandardWebhook, parseSecret } from '@/lib/email/standard-webhooks'
import { renderAuthEmail } from '@/lib/email/auth-emails'

const SECRET = 'v1,whsec_' + Buffer.from('a-test-secret-of-decent-length-1234').toString('base64')
const BODY = JSON.stringify({ user: { email: 'golfer@example.com' }, email_data: { token: '123456' } })

describe('Standard Webhooks verification', () => {
  const id = 'msg_123'
  const now = 1_800_000_000

  it('parses the Supabase secret prefix', () => {
    expect(parseSecret(SECRET).toString()).toBe('a-test-secret-of-decent-length-1234')
    expect(parseSecret('whsec_' + Buffer.from('x').toString('base64')).toString()).toBe('x')
  })

  it('accepts a correctly signed, fresh request', () => {
    const sig = sign(SECRET, id, now, BODY)
    const result = verifyStandardWebhook({
      secret: SECRET, body: BODY, now,
      headers: { id, timestamp: String(now), signature: `v1,${sig}` },
    })
    expect(result).toEqual({ ok: true })
  })

  it('accepts when the valid signature is one of several', () => {
    const sig = sign(SECRET, id, now, BODY)
    const result = verifyStandardWebhook({
      secret: SECRET, body: BODY, now,
      headers: { id, timestamp: String(now), signature: `v1,bm9wZQ== v1,${sig}` },
    })
    expect(result.ok).toBe(true)
  })

  it('rejects a tampered body', () => {
    const sig = sign(SECRET, id, now, BODY)
    const result = verifyStandardWebhook({
      secret: SECRET, body: BODY.replace('123456', '654321'), now,
      headers: { id, timestamp: String(now), signature: `v1,${sig}` },
    })
    expect(result.ok).toBe(false)
  })

  it('rejects the wrong secret', () => {
    const sig = sign('v1,whsec_' + Buffer.from('other').toString('base64'), id, now, BODY)
    const result = verifyStandardWebhook({
      secret: SECRET, body: BODY, now,
      headers: { id, timestamp: String(now), signature: `v1,${sig}` },
    })
    expect(result.ok).toBe(false)
  })

  it('rejects a stale timestamp (replay)', () => {
    const old = now - 3600
    const sig = sign(SECRET, id, old, BODY)
    const result = verifyStandardWebhook({
      secret: SECRET, body: BODY, now,
      headers: { id, timestamp: String(old), signature: `v1,${sig}` },
    })
    expect(result).toEqual({ ok: false, reason: 'timestamp outside tolerance' })
  })

  it('rejects when no secret is configured or headers are missing', () => {
    expect(verifyStandardWebhook({ secret: '', body: BODY, headers: { id, timestamp: String(now), signature: 'v1,x' } }).ok).toBe(false)
    expect(verifyStandardWebhook({ secret: SECRET, body: BODY, headers: {} }).ok).toBe(false)
  })
})

describe('renderAuthEmail', () => {
  const base = {
    to: 'golfer@example.com',
    token: '482913',
    tokenHash: 'abc123hash',
    redirectTo: 'https://www.getluckyholeinone.com/auth/callback?next=/select-course',
  }

  it('puts the six-digit code in the subject, the HTML and the text version', () => {
    const email = renderAuthEmail({ ...base, type: 'magiclink' })
    expect(email.subject).toContain('482913')
    expect(email.html).toContain('482913')
    expect(email.text).toContain('482913')
  })

  it('links to the confirm page with the token hash and the honoured next path', () => {
    const email = renderAuthEmail({ ...base, type: 'magiclink' })
    expect(email.html).toContain('/auth/confirm?token_hash=abc123hash&amp;type=magiclink&amp;next=%2Fselect-course')
    expect(email.text).toContain('/auth/confirm?token_hash=abc123hash&type=magiclink&next=%2Fselect-course')
  })

  it('drops a next path that is not a relative path', () => {
    const email = renderAuthEmail({ ...base, type: 'magiclink', redirectTo: 'https://evil.example/x?next=https://evil.example' })
    expect(email.html).not.toContain('evil.example')
  })

  it('maps every Supabase action type to a template', () => {
    for (const type of ['magiclink', 'signup', 'email', 'recovery', 'invite', 'email_change', 'reauthentication']) {
      const email = renderAuthEmail({ ...base, type })
      expect(email.subject.length).toBeGreaterThan(0)
      expect(email.html).toContain('<!DOCTYPE html>')
      expect(email.html).toContain('Indwe')
    }
  })

  it('escapes user-controlled values', () => {
    const email = renderAuthEmail({ ...base, type: 'email_change', newEmail: '<img src=x onerror=alert(1)>' })
    expect(email.html).not.toContain('<img src=x')
    expect(email.html).toContain('&lt;img src=x')
  })

  it('carries the brand assets and colours', () => {
    const email = renderAuthEmail({ ...base, type: 'magiclink' })
    expect(email.html).toContain('/brand/logo-lockup.png')
    expect(email.html).toContain('#d6fb4b')
    expect(email.html).toContain('#345231')
  })
})
