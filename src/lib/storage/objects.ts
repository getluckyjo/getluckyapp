/**
 * Bulk storage operations the app needs for deletion and retention.
 * Supabase Storage lists one folder at a time and removes by exact path;
 * these walk a folder and remove in chunks, and throw on any error so the
 * caller decides what a partial failure means.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

export type Bucket = 'shot-videos' | 'verification-docs'

/** The buckets that hold a golfer's own objects, under `<user id>/…`. */
export const USER_BUCKETS: readonly Bucket[] = ['shot-videos', 'verification-docs']

const PAGE = 100

/** Every object path under `prefix/` in a bucket, sub-folders included. */
export async function listObjectsUnder(client: SupabaseClient<Database>, bucket: Bucket, prefix: string): Promise<string[]> {
  const out: string[] = []
  const walk = async (folder: string): Promise<void> => {
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await client.storage.from(bucket).list(folder, { limit: PAGE, offset })
      if (error) throw new Error(`storage list ${bucket}/${folder}: ${error.message}`)
      if (!data || data.length === 0) return
      for (const entry of data) {
        const path = `${folder}/${entry.name}`
        // A folder placeholder comes back without an object id.
        if (entry.id == null) await walk(path)
        else out.push(path)
      }
      if (data.length < PAGE) return
    }
  }
  await walk(prefix.replace(/\/+$/, ''))
  return out
}

/** Remove the given paths from a bucket. Paths that are already gone are not an error. */
export async function removeObjects(client: SupabaseClient<Database>, bucket: Bucket, paths: string[]): Promise<void> {
  for (let i = 0; i < paths.length; i += PAGE) {
    const chunk = paths.slice(i, i + PAGE)
    const { error } = await client.storage.from(bucket).remove(chunk)
    if (error) throw new Error(`storage remove ${bucket}: ${error.message}`)
  }
}
