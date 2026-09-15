import { ScreenSkeleton } from '@/components/layout/Skeleton'

/** Play-flow screens: a course list or stake grid shape while the route loads. */
export default function PlayLoading() {
  return <ScreenSkeleton tone="surface" cards={4} />
}
