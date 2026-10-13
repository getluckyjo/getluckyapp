/**
 * The browser half of the Stitch wallet integration: what is switched on,
 * and the exact requests Apple Pay and Google Pay are asked for. Pure,
 * so the tests can pin the amounts and networks without a browser.
 *
 * Each NEXT_PUBLIC_ variable is read by its full name, which is how Next
 * inlines a value for the browser.
 *
 *   NEXT_PUBLIC_STITCH_APPLE_PAY=on            Apple Pay through Stitch on
 *                                              devices that have it; else
 *                                              the PayFast hosted-page button
 *   NEXT_PUBLIC_STITCH_GATEWAY_MERCHANT_ID     Google Pay on (Stitch's gateway
 *                                              merchant id for us)
 *   NEXT_PUBLIC_GOOGLE_PAY_MERCHANT_ID         from the Google Pay Business
 *                                              Console; required for PRODUCTION
 *   NEXT_PUBLIC_GOOGLE_PAY_ENV                 TEST or PRODUCTION; defaults to
 *                                              PRODUCTION on the production
 *                                              deployment, TEST elsewhere
 *   NEXT_PUBLIC_STITCH_GOOGLE_GATEWAY          the gateway name Google knows
 *                                              Stitch by; 'stitch' unless
 *                                              Stitch says otherwise
 */

export interface GooglePayPublicConfig {
  gateway: string
  gatewayMerchantId: string
  merchantId: string | null
  environment: 'TEST' | 'PRODUCTION'
}

export interface WalletPublicConfig {
  applePay: boolean
  googlePay: GooglePayPublicConfig | null
  merchantName: string
}

export const MERCHANT_NAME = 'Get Lucky Golf'

export function walletPublicConfig(env: Record<string, string | undefined> = {
  NEXT_PUBLIC_STITCH_APPLE_PAY: process.env.NEXT_PUBLIC_STITCH_APPLE_PAY,
  NEXT_PUBLIC_STITCH_GATEWAY_MERCHANT_ID: process.env.NEXT_PUBLIC_STITCH_GATEWAY_MERCHANT_ID,
  NEXT_PUBLIC_GOOGLE_PAY_MERCHANT_ID: process.env.NEXT_PUBLIC_GOOGLE_PAY_MERCHANT_ID,
  NEXT_PUBLIC_GOOGLE_PAY_ENV: process.env.NEXT_PUBLIC_GOOGLE_PAY_ENV,
  NEXT_PUBLIC_STITCH_GOOGLE_GATEWAY: process.env.NEXT_PUBLIC_STITCH_GOOGLE_GATEWAY,
  NEXT_PUBLIC_VERCEL_ENV: process.env.NEXT_PUBLIC_VERCEL_ENV,
}): WalletPublicConfig {
  const applePay = (env.NEXT_PUBLIC_STITCH_APPLE_PAY ?? '').trim().toLowerCase() === 'on'
  const gatewayMerchantId = (env.NEXT_PUBLIC_STITCH_GATEWAY_MERCHANT_ID ?? '').trim()
  const production = env.NEXT_PUBLIC_VERCEL_ENV === 'production'
  const envName = (env.NEXT_PUBLIC_GOOGLE_PAY_ENV ?? '').trim().toUpperCase()
  const environment: 'TEST' | 'PRODUCTION' = envName === 'PRODUCTION' || (envName === '' && production) ? 'PRODUCTION' : 'TEST'
  const merchantId = (env.NEXT_PUBLIC_GOOGLE_PAY_MERCHANT_ID ?? '').trim() || null
  // Google refuses a PRODUCTION request without a merchant id; better no button than a broken one.
  const googlePay: GooglePayPublicConfig | null = gatewayMerchantId && (environment === 'TEST' || merchantId)
    ? { gateway: (env.NEXT_PUBLIC_STITCH_GOOGLE_GATEWAY ?? '').trim() || 'stitch', gatewayMerchantId, merchantId, environment }
    : null
  return { applePay, googlePay, merchantName: MERCHANT_NAME }
}

/** Rand with two decimals, the string both sheets want and the server sends Stitch. */
export function walletAmount(amountZAR: number): string {
  return amountZAR.toFixed(2)
}

/** The Apple Pay sheet request (ApplePayPaymentRequest, version 3). */
export function applePayRequest(amountZAR: number, merchantName: string = MERCHANT_NAME) {
  return {
    countryCode: 'ZA',
    currencyCode: 'ZAR',
    supportedNetworks: ['visa', 'masterCard'],
    merchantCapabilities: ['supports3DS'],
    total: { label: merchantName, amount: walletAmount(amountZAR), type: 'final' },
  }
}

const GOOGLE_CARD = {
  type: 'CARD',
  parameters: {
    // Device-bound tokens only: a PAN-only token is a stored card number
    // with no cryptogram, which Stitch does not take for Google Pay.
    allowedAuthMethods: ['CRYPTOGRAM_3DS'],
    allowedCardNetworks: ['MASTERCARD', 'VISA'],
  },
}

/** What isReadyToPay is asked. */
export function googlePayReadyRequest() {
  return { apiVersion: 2, apiVersionMinor: 0, allowedPaymentMethods: [GOOGLE_CARD] }
}

/** The Google Pay sheet request (PaymentDataRequest). */
export function googlePayRequest(config: GooglePayPublicConfig, amountZAR: number, merchantName: string = MERCHANT_NAME) {
  return {
    apiVersion: 2,
    apiVersionMinor: 0,
    allowedPaymentMethods: [{
      ...GOOGLE_CARD,
      tokenizationSpecification: {
        type: 'PAYMENT_GATEWAY',
        parameters: { gateway: config.gateway, gatewayMerchantId: config.gatewayMerchantId },
      },
    }],
    transactionInfo: {
      totalPriceStatus: 'FINAL',
      totalPrice: walletAmount(amountZAR),
      currencyCode: 'ZAR',
      countryCode: 'ZA',
    },
    merchantInfo: { merchantName, ...(config.merchantId ? { merchantId: config.merchantId } : {}) },
  }
}

/** Base64 of a UTF-8 string, in the browser or in Node. */
export function base64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

/**
 * The token Stitch wants, from what the wallet handed over:
 * Apple Pay: the `paymentData` object of the payment token, as JSON, base64;
 * Google Pay: the `tokenizationData.token` string (already JSON), base64.
 */
export function encodeWalletToken(wallet: 'apple_pay', payload: { paymentData: unknown }): string
export function encodeWalletToken(wallet: 'google_pay', payload: { token: string }): string
export function encodeWalletToken(wallet: 'apple_pay' | 'google_pay', payload: { paymentData?: unknown; token?: string }): string {
  if (wallet === 'apple_pay') return base64Utf8(JSON.stringify(payload.paymentData))
  return base64Utf8(String(payload.token ?? ''))
}

/** Where a 3-D Secure page sends the golfer afterwards: our return page, which polls the ledger. */
export function threeDsReturnUrl(interactionUrl: string, origin: string, reference: string): string {
  const back = `${origin}/payment-return?ref=${encodeURIComponent(reference)}`
  const sep = interactionUrl.includes('?') ? '&' : '?'
  return `${interactionUrl}${sep}redirect_uri=${encodeURIComponent(back)}`
}
