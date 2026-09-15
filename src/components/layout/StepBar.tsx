/**
 * Three-segment progress bar — "Load or Process Bar.svg".
 *
 * Marks where someone is in the sign-in run: 1 = sign in, 2 = all set,
 * 3 = select a course. `tone="dark"` swaps the filled segments to lime for
 * photo backgrounds; on the grey surface they are brand green.
 */
export default function StepBar({
  step,
  total = 3,
  tone = 'light',
  className,
}: {
  step: number
  total?: number
  tone?: 'light' | 'dark'
  className?: string
}) {
  return (
    <div
      className={`step-bar step-bar--${tone}${className ? ` ${className}` : ''}`}
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={total}
      aria-valuenow={step}
      aria-label={`Step ${step} of ${total}`}
    >
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={i < step ? 'is-on' : undefined} />
      ))}
    </div>
  )
}
