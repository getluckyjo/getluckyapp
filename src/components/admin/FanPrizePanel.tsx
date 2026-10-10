'use client'

import { useEffect, useState } from 'react'
import ConfirmModal from '@/components/admin/ConfirmModal'

interface EventRow {
  id: string
  name: string
  first_tee_at: string | null
  winners_count: number
  frozen_at: string | null
  snapshot_sha256: string | null
  snapshot_count: number | null
  winning_icon_id: string | null
  draw_seed: string | null
  draw_sha256: string | null
  drawn_at: string | null
  picksOpen: boolean
}

interface Winner { position: number; user_id: string; icon_id: string; email: string | null; draw_rank: string }

interface Payload { data: EventRow; snapshotCount: number; eligibleCount: number; winners: Winner[] }

const OFFLINE = 'Could not reach the server. Check your connection and try again.'

/** A timestamptz as the value a datetime-local input wants, in South African time. */
function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(iso))
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '00'
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`
}

/** A datetime-local value, read as South African time, as ISO with its offset. */
function fromLocalInput(v: string): string | null {
  return v ? `${v}:00+02:00` : null
}

function when(iso: string | null): string {
  if (!iso) return ''
  return new Intl.DateTimeFormat('en-ZA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Johannesburg' }).format(new Date(iso))
}

/**
 * The fan prize, in three steps that can each run once: set first tee
 * (picks close then), freeze the backer list (its hash goes on record and
 * can be published), and after the ace, draw the winners from a seed
 * nobody could have known when the list was frozen. The record download
 * is what goes to the insurer.
 */
export default function FanPrizePanel({ icons, onChanged }: { icons: { id: string; name: string }[]; onChanged?: () => void }) {
  const [state, setState] = useState<Payload | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [tee, setTee] = useState('')
  const [teeBusy, setTeeBusy] = useState(false)
  const [teeMsg, setTeeMsg] = useState<string | null>(null)
  const [freezeOpen, setFreezeOpen] = useState(false)
  const [freezeBusy, setFreezeBusy] = useState(false)
  const [freezeError, setFreezeError] = useState<string | null>(null)
  const [winningIcon, setWinningIcon] = useState('')
  const [seed, setSeed] = useState('')
  const [drawOpen, setDrawOpen] = useState(false)
  const [drawBusy, setDrawBusy] = useState(false)
  const [drawError, setDrawError] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    let cancelled = false
    fetch('/api/admin/icons/event')
      .then(async res => {
        const json = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok) { setLoadError(json.error ?? `The server answered ${res.status}.`); return }
        setLoadError(null)
        setState(json as Payload)
        setTee(toLocalInput((json as Payload).data.first_tee_at))
      })
      .catch(() => { if (!cancelled) setLoadError(OFFLINE) })
    return () => { cancelled = true }
  }, [refresh])

  const event = state?.data ?? null
  const bump = () => { setRefresh(n => n + 1); onChanged?.() }

  async function saveTee(e: React.FormEvent) {
    e.preventDefault()
    setTeeBusy(true)
    setTeeMsg(null)
    try {
      const res = await fetch('/api/admin/icons/event', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstTeeAt: fromLocalInput(tee) }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setTeeMsg(json.error ?? 'Could not save. Please try again.'); return }
      setTeeMsg('Saved. Picks close at that moment.')
      bump()
    } catch {
      setTeeMsg(OFFLINE)
    } finally {
      setTeeBusy(false)
    }
  }

  async function freeze() {
    setFreezeBusy(true)
    setFreezeError(null)
    try {
      const res = await fetch('/api/admin/icons/event/freeze', { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setFreezeError(json.error ?? 'Could not freeze. Please try again.'); return }
      setFreezeOpen(false)
      bump()
    } catch {
      setFreezeError(OFFLINE)
    } finally {
      setFreezeBusy(false)
    }
  }

  async function draw() {
    setDrawBusy(true)
    setDrawError(null)
    try {
      const res = await fetch('/api/admin/icons/event/draw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ winningIconId: winningIcon, seed: seed.trim() }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setDrawError(json.error ?? 'Could not draw. Please try again.'); return }
      setDrawOpen(false)
      bump()
    } catch {
      setDrawError(OFFLINE)
    } finally {
      setDrawBusy(false)
    }
  }

  const iconName = (id: string | null) => icons.find(i => i.id === id)?.name ?? id ?? ''

  return (
    <section className="adm-card" style={{ marginBottom: 16 }} aria-labelledby="fan-prize-title">
      <h2 id="fan-prize-title" className="adm-title" style={{ fontSize: 18, margin: '0 0 4px' }}>Fan prize</h2>
      <p className="adm-lead" style={{ margin: '0 0 12px' }}>
        Three steps, each once. Picks close at first tee. Freeze the backer list before the shot and publish its hash. After the ace, draw with a seed nobody could have known.
      </p>

      {loadError && <p role="alert" className="adm-error">{loadError}</p>}
      {!state && !loadError && <p className="adm-muted">Loading…</p>}

      {event && (
        <div style={{ display: 'grid', gap: 14 }}>
          {/* 1. First tee */}
          <form onSubmit={saveTee} className="adm-row" style={{ alignItems: 'flex-end' }}>
            <label className="adm-field">
              1. First tee <span className="adm-hint">South African time; picks close then</span>
              <input id="fan-prize-first-tee" type="datetime-local" value={tee} onChange={e => setTee(e.target.value)} disabled={!!event.frozen_at} className="adm-input" />
            </label>
            {!event.frozen_at && <button type="submit" disabled={teeBusy} className="adm-btn">{teeBusy ? 'Saving…' : 'Save'}</button>}
            <span className={event.picksOpen ? 'adm-pill' : 'adm-pill adm-pill--green'}>{event.picksOpen ? 'Picks open' : 'Picks closed'}</span>
            {teeMsg && <span className="adm-small" role="status" style={{ flexBasis: '100%' }}>{teeMsg}</span>}
          </form>

          {/* 2. Freeze */}
          <div className="adm-row" style={{ alignItems: 'center' }}>
            <div style={{ flex: '1 1 320px' }}>
              <div style={{ fontWeight: 600 }}>2. Freeze the backer list</div>
              {event.frozen_at ? (
                <div className="adm-small">
                  Frozen {when(event.frozen_at)} · {event.snapshot_count?.toLocaleString('en-ZA')} backers, {state?.eligibleCount.toLocaleString('en-ZA')} eligible
                  <br />SHA-256 <code style={{ wordBreak: 'break-all' }}>{event.snapshot_sha256}</code>
                </div>
              ) : (
                <div className="adm-small">Copies every pick as it stands, with eligibility (18+, not staff, not suspended), and closes picks. Cannot be undone.</div>
              )}
            </div>
            {!event.frozen_at && <button type="button" onClick={() => { setFreezeError(null); setFreezeOpen(true) }} className="adm-btn">Freeze list</button>}
            {event.frozen_at && <a href="/api/admin/icons/event/record" className="adm-btn" download>Download record</a>}
          </div>

          {/* 3. Draw */}
          <div>
            <div style={{ fontWeight: 600 }}>3. Draw the winners</div>
            {event.drawn_at ? (
              <div className="adm-small" style={{ marginTop: 4 }}>
                Drawn {when(event.drawn_at)} · {iconName(event.winning_icon_id)} holed it · seed <code>{event.draw_seed}</code>
                <br />Draw SHA-256 <code style={{ wordBreak: 'break-all' }}>{event.draw_sha256}</code>
                <ol style={{ margin: '8px 0 0', paddingLeft: 20 }}>
                  {state?.winners.map(w => (
                    <li key={w.position}>{w.email ?? w.user_id} <span className="adm-muted">· rank {w.draw_rank.slice(0, 12)}…</span></li>
                  ))}
                </ol>
              </div>
            ) : (
              <form onSubmit={e => { e.preventDefault(); setDrawError(null); setDrawOpen(true) }} className="adm-row" style={{ alignItems: 'flex-end', marginTop: 4 }}>
                <label className="adm-field">
                  Icon who holed it
                  <select id="fan-prize-winning-icon" value={winningIcon} onChange={e => setWinningIcon(e.target.value)} required disabled={!event.frozen_at} className="adm-input">
                    <option value="">Choose…</option>
                    {icons.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                  </select>
                </label>
                <label className="adm-field" style={{ flex: '1 1 260px' }}>
                  Seed <span className="adm-hint">a public number from the day, e.g. the JSE All Share close</span>
                  <input id="fan-prize-seed" value={seed} onChange={e => setSeed(e.target.value)} minLength={8} maxLength={200} required disabled={!event.frozen_at} placeholder="JSE ALSI close 11 Dec 2026: 98765.43" className="adm-input" />
                </label>
                <button type="submit" disabled={!event.frozen_at || !winningIcon || seed.trim().length < 8} className="adm-btn">Draw {event.winners_count}</button>
                {!event.frozen_at && <span className="adm-small" style={{ flexBasis: '100%' }}>Freeze the list first.</span>}
              </form>
            )}
          </div>
        </div>
      )}

      <ConfirmModal
        open={freezeOpen}
        title="Freeze the backer list?"
        message="Picks close now, for everyone, and the list and its hash go on record. This cannot be undone or re-run."
        confirmLabel="Freeze list"
        variant="success"
        onConfirm={freeze}
        onCancel={() => setFreezeOpen(false)}
        busy={freezeBusy}
        error={freezeError}
      />
      <ConfirmModal
        open={drawOpen}
        title={`Draw the winners for ${iconName(winningIcon) || 'this Icon'}?`}
        message={`Seed: "${seed.trim()}". The draw runs once and is written to the record with this seed.`}
        confirmLabel="Run the draw"
        variant="success"
        onConfirm={draw}
        onCancel={() => setDrawOpen(false)}
        busy={drawBusy}
        error={drawError}
      />
    </section>
  )
}
