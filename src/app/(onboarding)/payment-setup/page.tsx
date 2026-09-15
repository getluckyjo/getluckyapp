'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import PhoneFrame from '@/components/layout/PhoneFrame'
import AppHeader from '@/components/layout/AppHeader'
import { useAuth } from '@/context/AuthContext'
import { createClient } from '@/lib/supabase/client'

const methods = [
  { id: 'card',       icon: '💳', name: 'Credit / Debit Card', desc: 'Visa, Mastercard, Amex'     },
  { id: 'eft',        icon: '🏦', name: 'Instant EFT',         desc: 'Direct from your bank'       },
  { id: 'apple_pay',  icon: '🍎', name: 'Apple Pay',            desc: 'Fastest checkout at the tee' },
  { id: 'google_pay', icon: 'G',  name: 'Google Pay',           desc: 'Quick tap-and-go'            },
]

export default function PaymentSetupPage() {
  const router = useRouter()
  const { user, refreshProfile } = useAuth()
  const [selected, setSelected] = useState('card')
  const [loading, setLoading] = useState(false)

  async function handleSave() {
    setLoading(true)

    if (user) {
      const supabase = createClient()

      // Pick up any pending profile data stored during signup
      const pendingName = localStorage.getItem('pending_name')
      const pendingHandicap = localStorage.getItem('pending_handicap')

      await supabase.from('profiles').upsert({
        id: user.id,
        payment_method: selected,
        payment_setup_done: true,
        onboarding_done: true,
        ...(pendingName ? { name: pendingName } : {}),
        ...(pendingHandicap ? { handicap: parseInt(pendingHandicap, 10) } : {}),
      })

      localStorage.removeItem('pending_name')
      localStorage.removeItem('pending_handicap')
      await refreshProfile()
    } else {
      // Not authenticated — store locally and proceed
      localStorage.setItem('payment_method', selected)
      await new Promise(r => setTimeout(r, 400))
    }

    setLoading(false)
    router.push('/home')
  }

  return (
    <PhoneFrame statusTheme="dark">
      <div className="screen-payment">
        <AppHeader tone="light" />
        <div className="signup-title-area" style={{ padding: 'clamp(8px, 2vh, 20px) var(--page-px) var(--space-md)' }}>
          <h3 className="signup-title">Payment Setup</h3>
          <p className="signup-sub">Choose how you'll pay when you play</p>
        </div>

        {/* PayFast trust badge */}
        <div style={{
          margin: '0 var(--page-px) var(--space-lg)',
          background: 'rgba(26, 61, 46, 0.07)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-md)',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-sm)',
          border: '1px solid rgba(26, 61, 46, 0.12)',
        }}>
          <div style={{ fontSize: 'var(--text-2xl)' }}>🔒</div>
          <div>
            <div style={{ color: '#1a3d2e', fontWeight: 700, fontSize: 'var(--text-body)' }}>
              Powered by PayFast
            </div>
            <div style={{ color: '#5a7a6a', fontSize: 'var(--text-xs)', marginTop: 2, lineHeight: 1.4 }}>
              SA&apos;s most trusted payment gateway. Your card details are
              never stored by Get Lucky.
            </div>
          </div>
        </div>

        <div className="payment-methods">
          <div className="payment-methods-title">Preferred Payment Method</div>
          {methods.map(m => (
            <div
              key={m.id}
              className={`payment-option${selected === m.id ? ' selected' : ''}`}
              onClick={() => setSelected(m.id)}
            >
              <div className="payment-option-icon">{m.icon}</div>
              <div className="payment-option-text">
                <h5>{m.name}</h5>
                <p>{m.desc}</p>
              </div>
              <div className="payment-radio" />
            </div>
          ))}
        </div>
        <div className="payment-secure">🔒 256-bit SSL · Secured by PayFast</div>
        <div style={{ padding: '0 var(--page-px) var(--space-2xl)' }}>
          <button
            className="btn-primary"
            onClick={handleSave}
            disabled={loading}
            style={{ opacity: loading ? 0.7 : 1 }}
          >
            {loading ? 'Saving...' : 'Save & Continue'}
          </button>
        </div>
      </div>
    </PhoneFrame>
  )
}
