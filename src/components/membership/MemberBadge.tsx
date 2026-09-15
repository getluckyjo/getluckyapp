'use client'

/** Small cosmetic "Member" pill in the V2 system: lime on green text. Status-only. */
export default function MemberBadge({
  size = 'md',
  style,
}: {
  size?: 'sm' | 'md'
  style?: React.CSSProperties
}) {
  const sm = size === 'sm'
  return (
    <span className={`member-badge${sm ? ' member-badge--sm' : ''}`} style={style}>
      <svg width={sm ? 10 : 12} height={sm ? 10 : 12} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M12 2l2.6 6.5L21 9l-5 4.3L17.5 20 12 16.5 6.5 20 8 13.3 3 9l6.4-.5z" />
      </svg>
      Member
    </span>
  )
}
