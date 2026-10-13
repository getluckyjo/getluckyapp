'use client'

/**
 * Apple Pay and Google Pay on the stake sheet, through Stitch.
 *
 * The wallet sheet opens on this page: no PayFast page, no leaving the
 * app. Apple Pay is Safari's own API (ApplePaySession); the merchant
 * session comes from /api/payments/wallet/validate. Google Pay is Google's
 * pay.js, loaded only when configured; its button is Google's own. Either
 * way the wallet hands over a token only Stitch can decrypt, this posts
 * it to /api/payments/wallet/charge, and the parent decides where to go.
 *
 * Shown only where a wallet is both configured (src/lib/stitch/public.ts)
 * and available on the device. Nothing here is rendered on the server.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import Script from 'next/script'
import { applePayRequest, encodeWalletToken, googlePayReadyRequest, googlePayRequest, walletPublicConfig, type GooglePayPublicConfig } from '@/lib/stitch/public'

export type WalletKind = 'apple_pay' | 'google_pay'

export interface WalletChargeResponse {
  betId?: string
  m_payment_id?: string
  interactionUrl?: string | null
  error?: string
  code?: string
}

export interface WalletOutcome {
  wallet: WalletKind
  status: number
  data: WalletChargeResponse
}

interface Props {
  amountZAR: number
  tier: string
  courseId: string
  holeId: string
  disabled?: boolean
  /** The charge route's answer, whatever it was. The parent routes the golfer. */
  onOutcome: (outcome: WalletOutcome) => void
  /** Something went wrong before Stitch was asked (the sheet failed to open, the merchant session was refused). */
  onError: (wallet: WalletKind, message: string) => void
  onBusy?: (busy: boolean) => void
}

interface ApplePayPaymentLike {
  token: { paymentData: unknown; paymentMethod?: { network?: string; displayName?: string; type?: string } }
}
interface ApplePaySessionLike {
  onvalidatemerchant: ((event: { validationURL: string }) => void) | null
  onpaymentauthorized: ((event: { payment: ApplePayPaymentLike }) => void) | null
  oncancel: (() => void) | null
  begin(): void
  abort(): void
  completeMerchantValidation(session: unknown): void
  completePayment(status: number): void
}
interface ApplePaySessionCtor {
  new (version: number, request: unknown): ApplePaySessionLike
  canMakePayments(): boolean
  STATUS_SUCCESS: number
  STATUS_FAILURE: number
}
interface GooglePaymentsClient {
  isReadyToPay(req: unknown): Promise<{ result: boolean }>
  loadPaymentData(req: unknown): Promise<{ paymentMethodData: { tokenizationData: { token: string }; info?: { cardNetwork?: string; cardDetails?: string } } }>
  createButton(opts: Record<string, unknown>): HTMLElement
}
declare global {
  interface Window {
    google?: { payments?: { api?: { PaymentsClient: new (opts: { environment: string }) => GooglePaymentsClient } } }
  }
}

const subscribeNever = () => () => {}
const applePaySession = (): ApplePaySessionCtor | null => {
  const ctor = (window as unknown as { ApplePaySession?: ApplePaySessionCtor }).ApplePaySession
  return ctor && typeof ctor.canMakePayments === 'function' && ctor.canMakePayments() ? ctor : null
}

async function postCharge(body: Record<string, unknown>): Promise<{ status: number; data: WalletChargeResponse }> {
  const res = await fetch('/api/payments/wallet/charge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({})) as WalletChargeResponse
  return { status: res.status, data }
}

export default function WalletButtons({ amountZAR, tier, courseId, holeId, disabled, onOutcome, onError, onBusy }: Props) {
  const config = walletPublicConfig()
  const appleAvailable = useSyncExternalStore(subscribeNever, () => config.applePay && !!applePaySession(), () => false)
  const [googleReady, setGoogleReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const googleHost = useRef<HTMLDivElement>(null)
  const googleClient = useRef<GooglePaymentsClient | null>(null)
  // Google's button is created once and keeps its onClick, so it reads the
  // current props through a ref that an effect keeps up to date.
  const latest = useRef({ amountZAR, tier, courseId, holeId, disabled, busy, onOutcome, onError })
  useEffect(() => {
    latest.current = { amountZAR, tier, courseId, holeId, disabled, busy, onOutcome, onError }
  }, [amountZAR, tier, courseId, holeId, disabled, busy, onOutcome, onError])

  const setBusyBoth = useCallback((b: boolean) => { setBusy(b); onBusy?.(b) }, [onBusy])

  // ── Apple Pay ──────────────────────────────────────────────────────────
  function payWithApple() {
    const Ctor = applePaySession()
    if (!Ctor || busy || disabled) return
    let session: ApplePaySessionLike
    try {
      session = new Ctor(3, applePayRequest(amountZAR, config.merchantName))
    } catch {
      onError('apple_pay', 'Apple Pay could not open. Pay another way below.')
      return
    }
    setBusyBoth(true)
    session.onvalidatemerchant = async event => {
      try {
        const res = await fetch('/api/payments/wallet/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ validationUrl: event.validationURL, initiativeContext: window.location.hostname }),
        })
        const data = await res.json().catch(() => ({})) as { session?: unknown; error?: string }
        if (!res.ok || !data.session) throw new Error(data.error ?? 'Apple Pay could not start.')
        session.completeMerchantValidation(data.session)
      } catch (err) {
        try { session.abort() } catch { /* already closed */ }
        setBusyBoth(false)
        onError('apple_pay', err instanceof Error && err.message ? err.message : 'Apple Pay could not start. Pay another way below.')
      }
    }
    session.onpaymentauthorized = async event => {
      const method = event.payment.token.paymentMethod ?? {}
      let outcome: { status: number; data: WalletChargeResponse }
      try {
        outcome = await postCharge({
          tier, courseId, holeId,
          wallet: 'apple_pay',
          token: encodeWalletToken('apple_pay', { paymentData: event.payment.token.paymentData }),
          card: { network: method.network ?? null, displayName: method.displayName ?? null, type: method.type ?? null },
        })
      } catch {
        outcome = { status: 0, data: { error: 'We could not reach the server. Check your shots before paying again.', code: 'NETWORK' } }
      }
      const paid = outcome.status === 200 || outcome.status === 202 || (outcome.status === 409 && !!outcome.data.m_payment_id && outcome.data.code !== 'CHARGE_UNKNOWN')
      try { session.completePayment(paid ? Ctor.STATUS_SUCCESS : Ctor.STATUS_FAILURE) } catch { /* sheet already gone */ }
      setBusyBoth(false)
      onOutcome({ wallet: 'apple_pay', ...outcome })
    }
    session.oncancel = () => setBusyBoth(false)
    try {
      session.begin()
    } catch {
      setBusyBoth(false)
      onError('apple_pay', 'Apple Pay could not open. Pay another way below.')
    }
  }

  // ── Google Pay ─────────────────────────────────────────────────────────
  const google = config.googlePay
  const payWithGoogle = useCallback(async (cfg: GooglePayPublicConfig) => {
    const client = googleClient.current
    const { amountZAR: amount, tier: t, courseId: c, holeId: h, disabled: d, busy: b, onOutcome: out, onError: fail } = latest.current
    if (!client || b || d) return
    setBusyBoth(true)
    let paymentData
    try {
      paymentData = await client.loadPaymentData(googlePayRequest(cfg, amount))
    } catch (err) {
      setBusyBoth(false)
      const code = (err as { statusCode?: string })?.statusCode
      if (code !== 'CANCELED') fail('google_pay', 'Google Pay could not complete. Pay another way below.')
      return
    }
    let outcome: { status: number; data: WalletChargeResponse }
    try {
      outcome = await postCharge({
        tier: t, courseId: c, holeId: h,
        wallet: 'google_pay',
        token: encodeWalletToken('google_pay', { token: paymentData.paymentMethodData.tokenizationData.token }),
        card: { network: paymentData.paymentMethodData.info?.cardNetwork ?? null, displayName: paymentData.paymentMethodData.info?.cardDetails ? `•••• ${paymentData.paymentMethodData.info.cardDetails}` : null },
      })
    } catch {
      outcome = { status: 0, data: { error: 'We could not reach the server. Check your shots before paying again.', code: 'NETWORK' } }
    }
    setBusyBoth(false)
    out({ wallet: 'google_pay', ...outcome })
  }, [setBusyBoth])

  const initGoogle = useCallback(() => {
    if (!google || googleClient.current) return
    const api = window.google?.payments?.api
    if (!api) return
    const client = new api.PaymentsClient({ environment: google.environment })
    googleClient.current = client
    client.isReadyToPay(googlePayReadyRequest())
      .then(r => { if (r.result) setGoogleReady(true) })
      .catch(() => { /* no Google Pay here; no button */ })
  }, [google])

  useEffect(() => {
    // pay.js may already be on the page (a second visit to the sheet).
    if (google && window.google?.payments?.api) initGoogle()
  }, [google, initGoogle])

  useEffect(() => {
    const host = googleHost.current
    const client = googleClient.current
    if (!googleReady || !host || !client || !google) return
    host.replaceChildren()
    let button: HTMLElement
    try {
      button = client.createButton({
        onClick: () => { void payWithGoogle(google) },
        buttonType: 'plain',
        buttonColor: 'black',
        buttonSizeMode: 'fill',
        buttonRadius: 6,
      })
    } catch {
      return
    }
    host.appendChild(button)
    return () => { host.replaceChildren() }
  }, [googleReady, google, payWithGoogle])

  if (!appleAvailable && !google) return null
  return (
    <>
      {appleAvailable && (
        <button type="button" className="stake-apple-pay" aria-label={`Pay R${amountZAR} with Apple Pay`} onClick={payWithApple} disabled={disabled || busy} />
      )}
      {google && (
        <>
          <Script src="https://pay.google.com/gp/p/js/pay.js" strategy="lazyOnload" onReady={initGoogle} />
          <div ref={googleHost} className={`stake-google-pay${googleReady ? '' : ' stake-google-pay--hidden'}${disabled || busy ? ' stake-google-pay--busy' : ''}`} aria-busy={busy} />
        </>
      )}
    </>
  )
}
