/**
 * Re-mounts on every navigation (unlike a layout), which is what gives each
 * screen its entrance: a 160 ms fade defined in globals.css (.page-enter).
 * Opacity only — a transform here would become the containing block for
 * any fixed-position child. Respects prefers-reduced-motion.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>
}
