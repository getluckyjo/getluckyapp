'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CreditCard, Landmark, Smartphone, Wallet, Lock } from 'lucide-react'
import PhoneFrame from '@/components/layout/PhoneFrame'
import AppHeader from '@/components/layout/AppHeader'
import { useAuth } from '@/context/AuthContext'
import { createClient } from '@/lib/supabase/client'

const methods = [
  { id: 'card',       Icon: CreditCard, name: 'Credit / debit card', desc: 'Visa, Mastercard, Amex'     },
  { id: 'eft',        Icon: Landmark,   name: 'Instant EFT',         desc: 'Direct from your bank'       },
  { id: 'apple_pay',  Icon: Smartphone, name: 'Apple Pay',           desc: 'Fastest checkout at the tee' },
  { id: 'google_pay', Icon: Wallet,     name: 'Google Pay',          desc: 'Quick tap-and-go'            },
]

/**
 * Payment setup — a preferred way to pay, in the V2 system.
 * Display title, a green PayFast trust card, the methods as white tiles
 * with a radio, and one lime SAVE. PayFast still takes the actual payment
 * at the tee; this only records the preference.
 */
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
      <div className="v2-screen">
        <AppHeader tone="light" />

        <div className="vf-scroll">
          <h1 className="v2-title" style={{ marginBottom: 8 }}>{'How you’ll\npay.'}</h1>
          <p className="vf-sub">Pick your preferred method. You&apos;re only charged when you play.</p>

          <div className="ps-trust">
            <span className="ps-trust-icon" aria-hidden><Lock size={20} strokeWidth={2.4} /></span>
            <div>
              <div className="ps-trust-title">Powered by PayFast</div>
              <div className="ps-trust-sub">SA&apos;s most trusted payment gateway. Your card details are never stored by Get Lucky.</div>
            </div>
          </div>

          <div className="ps-list" role="radiogroup" aria-label="Preferred payment method">
            {methods.map(({ id, Icon, name, desc }) => {
              const on = selected === id
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  className={`ps-option${on ? ' is-selected' : ''}`}
                  onClick={() => setSelected(id)}
                >
                  <span className="ps-option-icon" aria-hidden><Icon size={22} strokeWidth={2.2} /></span>
                  <span className="ps-option-text">
                    <span className="ps-option-name">{name}</span>
                    <span className="ps-option-desc">{desc}</span>
                  </span>
                  <span className="ps-radio" aria-hidden />
                </button>
              )
            })}
          </div>

          <button type="button" className="btn-lime btn-lime--block" onClick={handleSave} disabled={loading}>
            {loading ? 'Saving…' : 'Save & continue'}
          </button>
          <p className="ps-secure">256-bit SSL · Secured by PayFast</p>
        </div>
      </div>
    </PhoneFrame>
  )
}
