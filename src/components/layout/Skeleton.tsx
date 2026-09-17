import PhoneFrame from '@/components/layout/PhoneFrame'

/** A shimmering block. Sizes are inline so a loader can sketch its screen in a few lines. */
export function Bone({ w = '100%', h = 16, r = 8, style }: { w?: number | string; h?: number | string; r?: number; style?: React.CSSProperties }) {
  return <div className="bone" style={{ width: w, height: h, borderRadius: r, ...style }} aria-hidden />
}

/**
 * The shape of a V2 dashboard screen while its data loads: header with the
 * burger and corner sticker, a title, a few cards, and the tab bar's
 * footprint. No spinner. `tone="photo"` matches Home's dark background.
 */
export function ScreenSkeleton({ tone = 'surface', cards = 3 }: { tone?: 'surface' | 'photo'; cards?: number }) {
  const dark = tone === 'photo'
  return (
    <PhoneFrame statusTheme={dark ? 'light' : 'dark'}>
      <div className={`v2-screen${dark ? ' v2-screen--photo' : ''} skeleton-screen${dark ? ' skeleton-screen--dark' : ''}`} aria-busy="true" aria-label="Loading">
        <div className="app-header">
          <Bone w={28} h={20} r={4} style={{ marginTop: 16 }} />
          <Bone w={78} h={60} r={12} />
        </div>
        <div className="v2-body">
          <Bone w="62%" h={34} r={6} style={{ marginTop: 12 }} />
          <Bone w="40%" h={16} style={{ marginTop: 10, marginBottom: 22 }} />
          {Array.from({ length: cards }).map((_, i) => (
            <Bone key={i} h={i === 0 ? 120 : 76} r={16} style={{ marginBottom: 12 }} />
          ))}
        </div>
        <div className="skeleton-tabbar" aria-hidden>
          <div className="skeleton-pill" />
          <div className="skeleton-band" />
        </div>
      </div>
    </PhoneFrame>
  )
}
