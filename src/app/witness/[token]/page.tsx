'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import PhoneFrame from '@/components/layout/PhoneFrame'
import AppHeader from '@/components/layout/AppHeader'

type Info = { role: 'witness' | 'club_official'; witnessName: string; golferName: string; courseName: string; holeNumber: number; playedOn: string }
type State =
  | { kind: 'loading' }
  | { kind: 'ask'; info: Info }
  | { kind: 'sending'; info: Info }
  | { kind: 'done'; answer: 'yes' | 'no' }
  | { kind: 'gone'; reason: 'not_found' | 'expired' | 'answered' | 'error' }

/**
 * One question for a person who has no account: did you see it (or did the
 * club issue the certificate)? Reached from the email link; the token in the
 * URL is the only credential and it works once.
 */
export default function WitnessPage() {
  const { token } = useParams<{ token: string }>()
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [note, setNote] = useState('')

  useEffect(() => {
    let cancelled = false
    fetch(`/api/witness/${token}`)
      .then(async r => {
        const body = await r.json().catch(() => ({}))
        if (cancelled) return
        if (r.ok && body.ok) setState({ kind: 'ask', info: body })
        else setState({ kind: 'gone', reason: body.reason ?? 'error' })
      })
      .catch(() => { if (!cancelled) setState({ kind: 'gone', reason: 'error' }) })
    return () => { cancelled = true }
  }, [token])

  async function answer(a: 'yes' | 'no') {
    if (state.kind !== 'ask') return
    setState({ kind: 'sending', info: state.info })
    try {
      const r = await fetch(`/api/witness/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer: a, note: note.trim() || undefined }),
      })
      const body = await r.json().catch(() => ({}))
      if (r.ok && body.ok) setState({ kind: 'done', answer: a })
      else setState({ kind: 'gone', reason: body.reason ?? 'error' })
    } catch {
      setState({ kind: 'gone', reason: 'error' })
    }
  }

  const info = state.kind === 'ask' || state.kind === 'sending' ? state.info : null
  const isClub = info?.role === 'club_official'

  return (
    <PhoneFrame statusTheme="dark">
      <div className="v2-screen">
        <AppHeader tone="light" />
        <div className="vf-scroll legal">
          {state.kind === 'loading' && <p className="vf-sub">One moment…</p>}

          {info && (
            <>
              <h1 className="v2-title" style={{ marginBottom: 8 }}>{isClub ? 'A certificate\nto confirm' : 'Did you\nsee it?'}</h1>
              <p className="vf-sub">Hi {info.witnessName.split(' ')[0]}.</p>
              <p className="vf-sub">
                {isClub
                  ? `${info.golferName} has claimed a hole-in-one at ${info.courseName}, hole ${info.holeNumber}, on ${info.playedOn}, and named you as the club official who signed the certificate. Did your club issue that certificate?`
                  : `${info.golferName} has claimed a hole-in-one at ${info.courseName}, hole ${info.holeNumber}, on ${info.playedOn}, and says you were there. Did you see the ball go in?`}
              </p>
              <label className="acct-field" style={{ marginTop: 12 }}>
                <span>Anything the review team should know (optional)</span>
                <input className="acct-input" value={note} onChange={e => setNote(e.target.value)} maxLength={500} placeholder="e.g. I was standing on the tee next to him" />
              </label>
              <div className="cf-actions" style={{ marginTop: 16 }}>
                <button type="button" className="btn-lime btn-lime--block" disabled={state.kind === 'sending'} onClick={() => answer('yes')}>
                  {isClub ? 'Yes, we issued it' : 'Yes, I saw it go in'}
                </button>
                <button type="button" className="btn-tile btn-tile--block" disabled={state.kind === 'sending'} onClick={() => answer('no')}>
                  {isClub ? 'No, we did not' : 'No, or I’m not sure'}
                </button>
              </div>
              <p className="cf-note">Your answer goes to the review team and the insurer. It is not shown to the golfer.</p>
            </>
          )}

          {state.kind === 'done' && (
            <>
              <h1 className="v2-title" style={{ marginBottom: 8 }}>{'Thank\nyou'}</h1>
              <p className="vf-sub">{state.answer === 'yes' ? 'Recorded. That helps the claim move.' : 'Recorded. The review team will take it from here.'}</p>
            </>
          )}

          {state.kind === 'gone' && (
            <>
              <h1 className="v2-title" style={{ marginBottom: 8 }}>{'This link\nhas expired'}</h1>
              <p className="vf-sub">
                {state.reason === 'answered' ? 'This question has already been answered. Thank you.'
                  : state.reason === 'expired' ? 'Links work for 14 days. If you still want to answer, ask the golfer to have a new one sent, or write to support@getluckygolf.co.za.'
                  : state.reason === 'not_found' ? 'This link is not one we sent. If you copied it from an email, check it is complete.'
                  : 'Something went wrong. Please try the link again in a minute.'}
              </p>
            </>
          )}
        </div>
      </div>
    </PhoneFrame>
  )
}
