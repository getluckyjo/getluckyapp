import { ScreenSkeleton } from '@/components/layout/Skeleton'

/** Dashboard screens sketch themselves while loading; no spinner. */
export default function DashboardLoading() {
  return <ScreenSkeleton tone="surface" cards={3} />
}
