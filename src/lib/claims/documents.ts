/**
 * Claim documents are uploaded by the browser straight to storage; the
 * server never sees the bytes go by. So at submission it reads each one
 * back and records its hash and size on the verification, the same way the
 * footage is sealed. A document that cannot be read back was never
 * uploaded, and the claim is incomplete.
 */
import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

export interface DocumentSeal { sha256: string; bytes: number }

export class DocumentMissingError extends Error {
  constructor(public path: string) {
    super(`document not found in storage: ${path}`)
    this.name = 'DocumentMissingError'
  }
}

export async function sealDocument(admin: SupabaseClient<Database>, path: string): Promise<DocumentSeal> {
  const { data, error } = await admin.storage.from('verification-docs').download(path)
  if (error || !data) throw new DocumentMissingError(path)
  const buf = Buffer.from(await data.arrayBuffer())
  return { sha256: createHash('sha256').update(buf).digest('hex'), bytes: buf.byteLength }
}
