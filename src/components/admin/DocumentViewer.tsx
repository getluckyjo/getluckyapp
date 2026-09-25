'use client'

import { Download, ExternalLink, FileText, RotateCw } from 'lucide-react'
import { useId, useRef, useState } from 'react'

type Kind = 'certificate' | 'affidavit'

interface DocumentViewerProps {
  certificateUrl: string | null
  affidavitUrl: string | null
  /** Storage paths. The file type is read from these: a signed URL ends in ?token=…, never in .pdf. */
  certificatePath?: string | null
  affidavitPath?: string | null
  /** Signed with `download`, so the browser saves the file (a cross-origin `download` attribute is ignored). */
  certificateDownloadUrl?: string | null
  affidavitDownloadUrl?: string | null
  /** Documents on record whose link could not be made: not the same as never uploaded. */
  unsigned?: readonly string[]
  /** Fetch new links (they last an hour). */
  onReload?: () => void
}

const LABEL: Record<Kind, string> = { certificate: 'Certificate', affidavit: 'Affidavit' }

/** A PDF by its storage path, else by the URL's path; never by the whole URL, whose query string ends it. */
function isPdf(path: string | null | undefined, url: string): boolean {
  let name = path ?? ''
  if (!name) {
    try { name = new URL(url).pathname } catch { name = '' }
  }
  return /\.pdf$/i.test(name)
}

/** The claim's certificate and affidavit, one at a time, with links to open or save each. */
export default function DocumentViewer({
  certificateUrl, affidavitUrl, certificatePath, affidavitPath, certificateDownloadUrl, affidavitDownloadUrl, unsigned = [], onReload,
}: DocumentViewerProps) {
  const [active, setActive] = useState<Kind>(() => (!certificateUrl && affidavitUrl ? 'affidavit' : 'certificate'))
  // The URL whose image failed to load (an expired link); a new link clears it.
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null)
  const baseId = useId()
  const tabRefs = useRef<Record<Kind, HTMLButtonElement | null>>({ certificate: null, affidavit: null })

  const docs: Record<Kind, { url: string | null; path: string | null; download: string | null; unsigned: boolean }> = {
    certificate: { url: certificateUrl, path: certificatePath ?? null, download: certificateDownloadUrl ?? null, unsigned: unsigned.includes('certificate') },
    affidavit: { url: affidavitUrl, path: affidavitPath ?? null, download: affidavitDownloadUrl ?? null, unsigned: unsigned.includes('affidavit') },
  }
  const current = docs[active]
  const kinds: Kind[] = ['certificate', 'affidavit']

  // Arrow keys move between the tabs, as a tab list should.
  const onTabKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const next = active === 'certificate' ? 'affidavit' : 'certificate'
    setActive(next)
    tabRefs.current[next]?.focus()
  }

  return (
    <div>
      <div role="tablist" aria-label="Documents" onKeyDown={onTabKey} style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {kinds.map(kind => {
          const selected = active === kind
          const missing = !docs[kind].url && !docs[kind].unsigned
          return (
            <button
              key={kind}
              ref={el => { tabRefs.current[kind] = el }}
              type="button"
              role="tab"
              id={`${baseId}-${kind}-tab`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(kind)}
              className={`adm-btn ${selected ? 'adm-btn--green' : 'adm-btn--quiet'}`}
            >
              <FileText size={14} aria-hidden />
              {LABEL[kind]}
              {missing && <span className="adm-pill" style={{ padding: '1px 8px', fontSize: 11 }}>Missing</span>}
            </button>
          )
        })}
      </div>

      <div role="tabpanel" id={`${baseId}-panel`} aria-labelledby={`${baseId}-${active}-tab`}>
        {current.url ? (
          <>
            <div style={{ width: '100%', height: 420, borderRadius: 12, overflow: 'hidden', background: 'var(--surface)', position: 'relative' }}>
              {isPdf(current.path, current.url) ? (
                <iframe src={current.url} title={LABEL[active]} style={{ width: '100%', height: '100%', border: 'none' }} />
              ) : brokenUrl === current.url ? (
                <Unavailable text={`The ${LABEL[active].toLowerCase()} link has expired. Reload the claim.`} onReload={onReload} />
              ) : (
                // A signed storage URL to claim evidence: it must not pass through
                // the image optimiser (which would cache it), so a plain <img>.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={current.url}
                  alt={LABEL[active]}
                  onError={() => setBrokenUrl(current.url)}
                  style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
                />
              )}
            </div>
            <div className="adm-row" style={{ marginTop: 10 }}>
              <a href={current.url} target="_blank" rel="noopener noreferrer" className="adm-btn adm-btn--quiet" style={{ textDecoration: 'none' }}>
                <ExternalLink size={14} aria-hidden /> Open in a new tab
              </a>
              <a href={current.download ?? current.url} download className="adm-btn adm-btn--quiet" style={{ textDecoration: 'none' }}>
                <Download size={14} aria-hidden /> Download
              </a>
            </div>
          </>
        ) : current.unsigned ? (
          <div style={{ height: 200, borderRadius: 12, background: 'var(--surface)' }}>
            <Unavailable text={`The ${LABEL[active].toLowerCase()} is on record, but its link could not be made.`} onReload={onReload} />
          </div>
        ) : (
          <div className="adm-muted" style={{ height: 200, borderRadius: 12, border: '1.5px dashed var(--cream-dark)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: 14 }}>
            <FileText size={28} aria-hidden />
            {LABEL[active]} not uploaded yet
          </div>
        )}
      </div>
    </div>
  )
}

function Unavailable({ text, onReload }: { text: string; onReload?: () => void }) {
  return (
    <div role="alert" style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 20, textAlign: 'center' }}>
      <p className="adm-warn" style={{ margin: 0, fontSize: 13 }}>{text}</p>
      {onReload && (
        <button type="button" onClick={onReload} className="adm-btn adm-btn--quiet"><RotateCw size={14} aria-hidden /> Reload the claim</button>
      )}
    </div>
  )
}
