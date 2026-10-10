'use client'

import { useEffect, useState } from 'react'
import { Gift, Pause, Play } from 'lucide-react'

/** /api/admin/free-swings. */
interface CapStatus {
  dailyCap: number
  paused: boolean
  usedToday: number
  open: boolean
  envPaused: boolean
  updatedAt: string | null
}

/**
 * Free swings today: how many of the day's cap are gone, the cap itself,
 * and the pause switch (migration 038). Each free swing is a R10,000 prize
 * with nothing behind it, so this is the one number that bounds the
 * exposure. FREE_SWING_PAUSED in Vercel pauses them too, and is shown here
 * but set there.
 */
export default function FreeSwingCapCard() {
  const [status, setStatus] = useState<CapStatus | null>(null)
  const [failed, setFailed] = useState(false)
  const [cap, setCap] = useState('')
  const [busy, setBusy] = useState<'cap' | 'pause' | null>(null)
  const [note, setNote] = useState<{ error: boolean; text: string } | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    fetch('/api/admin/free-swings', { cache: 'no-store' })
      .then(async res => {
        const json = await res.json().catch(() => null)
        if (cancelled) return
        if (res.ok && json?.data) { setStatus(json.data as CapStatus); setCap(String((json.data as CapStatus).dailyCap)); setFailed(false) }
        else setFailed(true)
      })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [attempt])

  async function send(body: { dailyCap?: number; paused?: boolean }, what: 'cap' | 'pause') {
    setBusy(what)
    setNote(null)
    try {
      const res = await fetch('/api/admin/free-swings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.data) { setNote({ error: true, text: json?.error ?? 'That did not save. Please try again.' }); return }
      const next = json.data as CapStatus
      setStatus(next)
      setCap(String(next.dailyCap))
      setNote({ error: false, text: what === 'pause' ? (next.paused ? 'Free swings are paused.' : 'Free swings are back on.') : `The cap is ${next.dailyCap.toLocaleString('en-ZA')} a day.` })
    } catch {
      setNote({ error: true, text: 'That did not reach the server. Check your connection, then try again.' })
    } finally {
      setBusy(null)
    }
  }

  function saveCap(e: React.FormEvent) {
    e.preventDefault()
    const n = Number(cap)
    if (!Number.isInteger(n) || n < 0 || n > 100000) { setNote({ error: true, text: 'The cap is a whole number from 0 to 100 000.' }); return }
    void send({ dailyCap: n }, 'cap')
  }

  const off = status ? status.paused || status.envPaused : false
  const pill = !status ? null
    : status.envPaused ? { text: 'Paused in Vercel', cls: 'adm-pill adm-pill--red' }
    : status.paused ? { text: 'Paused', cls: 'adm-pill adm-pill--red' }
    : status.open ? { text: 'On', cls: 'adm-pill adm-pill--green' }
    : { text: 'Full for today', cls: 'adm-pill adm-pill--lime' }

  return (
    <section className="adm-card" style={{ marginTop: 0 }} aria-busy={!status && !failed}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
        <h2 className="adm-h2" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Gift size={18} aria-hidden /> Free swings today</h2>
        {pill && <span className={pill.cls}>{pill.text}</span>}
      </div>
      {failed ? (
        <p className="adm-error" style={{ margin: 0 }}>
          The free swing cap could not be read.{' '}
          <button type="button" className="adm-link" onClick={() => setAttempt(n => n + 1)}>Try again</button>
        </p>
      ) : !status ? (
        <p className="adm-muted" style={{ margin: 0 }}>Loading…</p>
      ) : (
        <>
          <p style={{ margin: '0 0 12px', fontSize: 14 }}>
            <strong className="adm-stat-value" style={{ fontSize: 26 }}>{status.usedToday.toLocaleString('en-ZA')}</strong>
            <span className="adm-muted"> of {status.dailyCap.toLocaleString('en-ZA')} taken (South African day). Each one is a R10 000 prize with no stake behind it.</span>
          </p>
          <form onSubmit={saveCap} className="adm-row" style={{ alignItems: 'flex-end', gap: 10 }}>
            <label className="adm-field">
              Cap a day
              <input type="number" min={0} max={100000} value={cap} onChange={e => setCap(e.target.value)} className="adm-input" style={{ width: 120 }} />
            </label>
            <button type="submit" className="adm-btn adm-btn--quiet" disabled={busy !== null || Number(cap) === status.dailyCap}>
              {busy === 'cap' ? 'Saving…' : 'Set cap'}
            </button>
            <button
              type="button"
              className={`adm-btn${status.paused ? ' adm-btn--green' : ' adm-btn--danger adm-btn--quiet'}`}
              onClick={() => send({ paused: !status.paused }, 'pause')}
              disabled={busy !== null}
            >
              {status.paused ? <Play size={15} aria-hidden /> : <Pause size={15} aria-hidden />}{' '}
              {busy === 'pause' ? 'Saving…' : status.paused ? 'Resume free swings' : 'Pause free swings'}
            </button>
          </form>
          {status.envPaused && (
            <p className="adm-warn" style={{ margin: '10px 0 0' }}>
              FREE_SWING_PAUSED=on is set in Vercel, so free swings are off whatever the switch above says. Unset it there to bring them back.
            </p>
          )}
          {note && <p role={note.error ? 'alert' : 'status'} className={note.error ? 'adm-error' : 'adm-small'} style={{ margin: '10px 0 0' }}>{note.text}</p>}
          {off && !note && <p className="adm-small" style={{ margin: '10px 0 0' }}>Golfers see &ldquo;{'Free swings are fully booked for today. Try again tomorrow.'}&rdquo; Paid entries are not affected.</p>}
        </>
      )}
    </section>
  )
}
