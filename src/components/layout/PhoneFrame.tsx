'use client'

interface PhoneFrameProps {
  children: React.ReactNode
  statusTheme?: 'light' | 'dark'
  showStatus?: boolean
  /** Kept for call-site compatibility. V2 places the sponsor on the landing page, not in the frame. */
  hideSponsor?: boolean
}

export default function PhoneFrame({ children }: PhoneFrameProps) {
  return (
    <div
      className="phone-frame-outer"
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--green-dark)',
        padding: 'clamp(12px, 3vw, 20px)',
      }}
    >
      {/* Desktop: phone frame wrapper */}
      <div className="phone-frame-shell" style={{ position: 'relative' }}>
        <div className="phone-notch" />
        <div className="phone-screen">
          <main className="phone-screen-content">
            {children}
          </main>
        </div>
      </div>

      {/* Responsive overrides */}
      <style>{`
        @media (max-width: 430px) {
          .phone-frame-outer { padding: 0 !important; }
          .phone-frame-shell {
            width: 100vw !important;
            height: 100dvh !important;
            border-radius: 0 !important;
            padding: 0 !important;
            box-shadow: none !important;
          }
          .phone-notch { display: none; }
          .phone-screen { border-radius: 0 !important; }
        }
        @media (min-width: 431px) and (max-width: 768px) {
          .phone-frame-shell {
            width: min(90vw, 480px) !important;
            height: min(92vh, 900px) !important;
            border-radius: 36px !important;
            padding: 10px !important;
          }
        }
      `}</style>
    </div>
  )
}
