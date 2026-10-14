/**
 * The play flow's layout. BetProvider used to live here; it is mounted at
 * the root now (src/app/layout.tsx), so a golfer who taps Home while a
 * shot is uploading keeps the session and the upload keeps going.
 */
export default function PlayLayout({ children }: { children: React.ReactNode }) {
  return children
}
