'use client'

import { useState } from 'react'
import { ImagePlus, Trash2 } from 'lucide-react'
import { GolfDayHeroArt, GolfDayLabel, themeVars } from '@/components/golf-days/GolfDayCard'
import { HEX_COLOUR, alcoholFootnote, contrast, type GolfDayLook, type Palette } from '@/lib/golf-days/look'
import { DEFAULT_THEME, type GolfDayHero, type GolfDayTheme } from '@/lib/golf-days/themes'
import type { GolfDayHole } from '@/lib/golf-days/rules'

/** A golf day's look as the form holds it: text as typed, colours as #rrggbb. */
export interface LookForm {
  hero: GolfDayHero | null
  host: string
  venue: string
  tagline: string
  footnote: string
  ink: string
  accent: string
  paper: string
  page: string
}

export const BLANK_LOOK: LookForm = {
  hero: null, host: '', venue: '', tagline: '', footnote: '',
  ink: DEFAULT_THEME.ink, accent: DEFAULT_THEME.accent, paper: DEFAULT_THEME.paper, page: DEFAULT_THEME.page,
}

/** The form for a golf day's current look (its saved look over its code theme). */
export function lookFormFrom(theme: GolfDayTheme): LookForm {
  return {
    hero: theme.hero,
    host: theme.host === DEFAULT_THEME.host ? '' : theme.host,
    venue: theme.venue ?? '',
    tagline: theme.tagline === DEFAULT_THEME.tagline ? '' : theme.tagline,
    footnote: theme.footnote ?? '',
    ink: theme.ink, accent: theme.accent, paper: theme.paper, page: theme.page,
  }
}

/** What is saved: null for the Get Lucky look untouched, so it keeps following the default. */
export function lookFrom(form: LookForm, name: string): GolfDayLook | null {
  const blank = !form.hero && !form.host.trim() && !form.venue.trim() && !form.tagline.trim() && !form.footnote.trim()
    && form.ink === BLANK_LOOK.ink && form.accent === BLANK_LOOK.accent && form.paper === BLANK_LOOK.paper && form.page === BLANK_LOOK.page
  if (blank) return null
  const host = form.host.trim()
  return {
    ...(host ? { host } : {}),
    venue: form.venue.trim() || null,
    ...(form.tagline.trim() ? { tagline: form.tagline.trim() } : {}),
    footnote: form.footnote.trim() || null,
    ink: form.ink, accent: form.accent, paper: form.paper, page: form.page,
    hero: form.hero ? { ...form.hero, alt: form.hero.alt.trim() || `${host || name} ${form.hero.kind}` } : null,
  }
}

/** The theme the preview shows for this form. */
function previewTheme(form: LookForm): GolfDayTheme {
  const ok = (c: string, fallback: string) => (HEX_COLOUR.test(c) ? c : fallback)
  return {
    hero: form.hero,
    host: form.host.trim() || DEFAULT_THEME.host,
    venue: form.venue.trim() || null,
    tagline: form.tagline.trim() || DEFAULT_THEME.tagline,
    footnote: form.footnote.trim() || null,
    ink: ok(form.ink, DEFAULT_THEME.ink),
    accent: ok(form.accent, DEFAULT_THEME.accent),
    paper: ok(form.paper, DEFAULT_THEME.paper),
    page: ok(form.page, DEFAULT_THEME.page),
  }
}

/**
 * Shrunk in the browser before it goes up (a phone photo is several MB),
 * keeping any transparency: WebP where the browser can write it, PNG if not.
 */
async function shrink(file: File): Promise<Blob> {
  if (file.size < 1_500_000) return file
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, 1600 / bitmap.width)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  const as = (type: string, quality?: number) => new Promise<Blob | null>(res => canvas.toBlob(res, type, quality))
  const webp = await as('image/webp', 0.92)
  return webp?.type === 'image/webp' ? webp : (await as('image/png')) ?? file
}

const COLOURS: { key: 'ink' | 'accent' | 'paper' | 'page'; label: string; hint: string }[] = [
  { key: 'ink', label: 'Ink', hint: 'Type, lines, buttons' },
  { key: 'accent', label: 'Accent', hint: 'Rules and shadows only' },
  { key: 'paper', label: 'Card', hint: 'The label' },
  { key: 'page', label: 'Page', hint: 'Behind it all' },
]

/**
 * The look of a golf day's screen: its picture, host, venue, tagline, small
 * print and colours, with a preview built from the player screen's own
 * card. Uploading a picture suggests colours from it.
 */
export default function LookEditor({ form, onChange, name, prizeZAR, playsOn, holes }: {
  form: LookForm
  onChange: (form: LookForm) => void
  name: string
  prizeZAR: number
  playsOn: string
  holes: GolfDayHole[]
}) {
  const [uploading, setUploading] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const set = <K extends keyof LookForm>(key: K, value: LookForm[K]) => onChange({ ...form, [key]: value })

  async function upload(file: File) {
    setProblem(null)
    setUploading(true)
    try {
      const body = new FormData()
      body.append('file', await shrink(file), file.name)
      const res = await fetch('/api/admin/golf-days/art', { method: 'POST', body })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setProblem(json.error ?? 'The picture could not be uploaded.'); return }
      const palette = json.palette as Palette
      onChange({ ...form, hero: json.hero as GolfDayHero, ...palette })
    } catch {
      setProblem('The picture could not be uploaded.')
    } finally {
      setUploading(false)
    }
  }

  const theme = previewTheme(form)
  const readable = contrast(theme.ink, theme.paper)

  return (
    <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <div className="adm-stack" style={{ flex: '1 1 340px', maxWidth: 560 }}>
        <div className="adm-field">
          Picture <span className="adm-hint">The host&rsquo;s logo, or a photo</span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <label className="adm-btn adm-btn--green" style={{ cursor: uploading ? 'wait' : 'pointer' }}>
              <ImagePlus size={15} aria-hidden /> {uploading ? 'Uploading…' : form.hero ? 'Replace picture' : 'Upload picture'}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={uploading}
                style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f) }}
              />
            </label>
            {form.hero && (
              <>
                <select value={form.hero.kind} onChange={e => set('hero', { ...form.hero!, kind: e.target.value as 'photo' | 'logo' })} className="adm-input" aria-label="How the picture is shown">
                  <option value="logo">Logo: shown whole</option>
                  <option value="photo">Photo: fills the top</option>
                </select>
                <button type="button" onClick={() => set('hero', null)} className="adm-btn adm-btn--quiet adm-btn--danger">
                  <Trash2 size={14} aria-hidden /> Remove
                </button>
              </>
            )}
          </div>
          {form.hero && (
            <input value={form.hero.alt} onChange={e => set('hero', { ...form.hero!, alt: e.target.value })} placeholder="Describe it, for screen readers (optional)" maxLength={200} className="adm-input" aria-label="Picture description" />
          )}
          <span className="adm-hint">A logo with a see-through background is shown whole; a photo fills the top. Colours are suggested from it.</span>
          {problem && <span role="alert" className="adm-error">{problem}</span>}
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <label className="adm-field" style={{ flex: '1 1 200px' }}>
            Host <span className="adm-hint">Reads &ldquo;Host × Get Lucky&rdquo;</span>
            <input value={form.host} onChange={e => set('host', e.target.value)} placeholder="Bomb Squad Lager" maxLength={60} className="adm-input" />
          </label>
          <label className="adm-field" style={{ flex: '1 1 160px' }}>
            Venue on the label
            <input value={form.venue} onChange={e => set('venue', e.target.value)} placeholder="Royal Johannesburg" maxLength={40} className="adm-input" />
          </label>
        </div>
        <label className="adm-field">
          Line under the prize
          <input value={form.tagline} onChange={e => set('tagline', e.target.value)} placeholder={DEFAULT_THEME.tagline} maxLength={120} className="adm-input" />
        </label>
        <label className="adm-field">
          Small print <span className="adm-hint">Optional</span>
          <input value={form.footnote} onChange={e => set('footnote', e.target.value)} placeholder="None" maxLength={200} className="adm-input" />
          <span>
            <button type="button" onClick={() => set('footnote', alcoholFootnote(form.host || name))} className="adm-link" style={{ fontSize: 12 }}>
              Alcohol brand? Add the 18+ line
            </button>
          </span>
        </label>

        <div className="adm-field">
          Colours
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            {COLOURS.map(c => (
              <label key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }} title={c.hint}>
                <input type="color" value={HEX_COLOUR.test(form[c.key]) ? form[c.key] : '#000000'} onChange={e => set(c.key, e.target.value)} style={{ width: 38, height: 34, padding: 2, border: '1.5px solid var(--cream-dark)', borderRadius: 10, background: 'var(--white)', cursor: 'pointer' }} />
                <span style={{ display: 'flex', flexDirection: 'column' }}>
                  {c.label}
                  <span className="adm-hint" style={{ fontSize: 11 }}>{c.hint}</span>
                </span>
              </label>
            ))}
          </div>
          {readable < 7 && (
            <span role="alert" className="adm-warn">
              Ink on the card reads at {readable.toFixed(1)}:1; the label needs 7:1. Darken the ink or lighten the card.
            </span>
          )}
        </div>
      </div>

      <div style={{ flex: '0 1 340px', minWidth: 0 }}>
        <div className="adm-h3" style={{ marginBottom: 8 }}>Preview</div>
        <div
          className={`gd-screen${theme.hero ? ' gd-branded' : ''}`}
          style={{ ...themeVars(theme), width: 'min(340px, 100%)', padding: '14px 14px 18px', borderRadius: 24, border: '8px solid #111', maxHeight: 760, overflowY: 'auto' }}
        >
          {theme.hero && <GolfDayHeroArt hero={theme.hero} />}
          <GolfDayLabel theme={theme} name={name || 'Your Golf Day'} prizeZAR={prizeZAR || 0} playsOn={playsOn} holes={holes} />
          <div className="gd-action">
            <button type="button" className="btn-lime btn-lime--block" tabIndex={-1}>Join the golf day</button>
          </div>
          {theme.footnote && <p className="gd-footnote">{theme.footnote}</p>}
        </div>
      </div>
    </div>
  )
}
