/**
 * Back an Icon: the field is public, a pick needs a session, one pick per
 * golfer that re-picking replaces, only an active Icon can be picked, and
 * the admin routes are admin-only.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FakeDb, createFakeClient, jsonRequest, USER_A, USER_B } from '../helpers/fake-supabase'

const serverClient = vi.hoisted(() => ({ createClient: vi.fn() }))
const adminClient = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => serverClient)
vi.mock('@/lib/supabase/admin', () => adminClient)

import { GET as listIcons } from '@/app/api/icons/route'
import { POST as vote } from '@/app/api/icons/vote/route'
import { GET as adminList, POST as adminCreate } from '@/app/api/admin/icons/route'
import { PATCH as adminPatch, DELETE as adminDelete } from '@/app/api/admin/icons/[iconId]/route'
import { withShares, iconInitials } from '@/lib/icons'

const ICON_A = '55555555-5555-4555-8555-555555555555'
const ICON_B = '66666666-6666-4666-8666-666666666666'
const ICON_OFF = '77777777-7777-4777-8777-777777777777'

let db: FakeDb
const asUser = (user: typeof USER_A | null) => serverClient.createClient.mockResolvedValue(createFakeClient(db, user ? { user } : {}))
const asAdmin = () => {
  db.seed('profiles', { id: USER_A.id, name: 'Seed Admin', is_admin: true })
  asUser(USER_A)
}
const params = (iconId: string) => ({ params: Promise.resolve({ iconId }) })
const post = (url: string, body: unknown) => jsonRequest(url, body)

beforeEach(() => {
  db = new FakeDb()
  db.seed('icons',
    { id: ICON_A, name: 'Ernie Els', tagline: 'The Big Easy', photo_url: null, sort_order: 1, is_active: true },
    { id: ICON_B, name: 'Retief Goosen', tagline: null, photo_url: null, sort_order: 2, is_active: true },
    { id: ICON_OFF, name: 'Hidden Icon', tagline: null, photo_url: null, sort_order: 3, is_active: false },
  )
  serverClient.createClient.mockReset()
  adminClient.createAdminClient.mockImplementation(() => createFakeClient(db))
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('GET /api/icons', () => {
  it('lists active icons with counts and shares, signed out', async () => {
    asUser(null)
    db.seed('icon_votes', { user_id: USER_A.id, icon_id: ICON_A }, { user_id: USER_B.id, icon_id: ICON_A }, { user_id: 'u3', icon_id: ICON_B })
    const res = await listIcons()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.icons.map((i: { id: string }) => i.id)).toEqual([ICON_A, ICON_B])
    expect(json.icons[0]).toMatchObject({ name: 'Ernie Els', votes: 2, percent: 67 })
    expect(json.icons[1]).toMatchObject({ votes: 1, percent: 33 })
    expect(json.totalVotes).toBe(3)
    expect(json.myVote).toBeNull()
    expect(json.event.name).toBe('Icons Cup South Africa')
  })

  it('includes the caller\'s own pick when signed in', async () => {
    asUser(USER_B)
    db.seed('icon_votes', { user_id: USER_B.id, icon_id: ICON_B })
    const json = await (await listIcons()).json()
    expect(json.myVote).toBe(ICON_B)
  })
})

describe('POST /api/icons/vote', () => {
  it('401 signed out', async () => {
    asUser(null)
    expect((await vote(post('http://x/api/icons/vote', { iconId: ICON_A }))).status).toBe(401)
  })

  it('400 on a malformed id', async () => {
    asUser(USER_A)
    expect((await vote(post('http://x/api/icons/vote', { iconId: 'ernie' }))).status).toBe(400)
  })

  it('404 for an unknown or inactive icon', async () => {
    asUser(USER_A)
    expect((await vote(post('http://x/api/icons/vote', { iconId: ICON_OFF }))).status).toBe(404)
    expect((await vote(post('http://x/api/icons/vote', { iconId: '88888888-8888-4888-8888-888888888888' }))).status).toBe(404)
    expect(db.rows('icon_votes')).toHaveLength(0)
  })

  it('records one pick per golfer and replaces it on re-pick', async () => {
    asUser(USER_A)
    const first = await vote(post('http://x/api/icons/vote', { iconId: ICON_A }))
    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({ ok: true, myVote: ICON_A })
    const second = await vote(post('http://x/api/icons/vote', { iconId: ICON_B }))
    expect(second.status).toBe(200)
    const rows = db.rows('icon_votes')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ user_id: USER_A.id, icon_id: ICON_B })
  })
})

describe('admin icons', () => {
  it('401/403 for non-admins', async () => {
    asUser(null)
    expect((await adminList()).status).toBe(401)
    db.seed('profiles', { id: USER_B.id, name: 'Bob', is_admin: false })
    asUser(USER_B)
    expect((await adminList()).status).toBe(403)
    expect((await adminCreate(post('http://x/api/admin/icons', { name: 'X' }))).status).toBe(403)
  })

  it('lists every icon, active or not, with pick counts', async () => {
    asAdmin()
    db.seed('icon_votes', { user_id: USER_B.id, icon_id: ICON_OFF })
    const json = await (await adminList()).json()
    expect(json.data).toHaveLength(3)
    expect(json.data.find((i: { id: string }) => i.id === ICON_OFF).votes).toBe(1)
    expect(json.totalVotes).toBe(1)
  })

  it('creates, updates and deletes an icon; validation holds', async () => {
    asAdmin()
    expect((await adminCreate(post('http://x/api/admin/icons', { name: '' }))).status).toBe(400)
    expect((await adminCreate(post('http://x/api/admin/icons', { name: 'Gary Player', photoUrl: 'not a url' }))).status).toBe(400)
    const created = await adminCreate(post('http://x/api/admin/icons', { name: 'Gary Player', tagline: 'The Black Knight', sortOrder: 0 }))
    expect(created.status).toBe(201)
    const { data } = await created.json()
    expect(data).toMatchObject({ name: 'Gary Player', tagline: 'The Black Knight', sort_order: 0, is_active: true })

    const patched = await adminPatch(post(`http://x/api/admin/icons/${data.id}`, { isActive: false, tagline: '' }), params(data.id))
    expect(patched.status).toBe(200)
    expect((await patched.json()).data).toMatchObject({ is_active: false, tagline: null })
    expect((await adminPatch(post(`http://x/api/admin/icons/${data.id}`, {}), params(data.id))).status).toBe(400)
    expect((await adminPatch(post('http://x/api/admin/icons/nope', { isActive: true }), params('nope'))).status).toBe(400)

    expect((await adminDelete(new Request(`http://x/api/admin/icons/${data.id}`, { method: 'DELETE' }), params(data.id))).status).toBe(200)
    expect(db.rows('icons').find(i => i.id === data.id)).toBeUndefined()
  })
})

describe('lib', () => {
  it('shares round to whole percents and are 0 with no picks', () => {
    expect(withShares([{ votes: 0 }, { votes: 0 }]).map(r => r.percent)).toEqual([0, 0])
    expect(withShares([{ votes: 1 }, { votes: 2 }]).map(r => r.percent)).toEqual([33, 67])
  })
  it('initials', () => {
    expect(iconInitials('Ernie Els')).toBe('EE')
    expect(iconInitials('Louis Oosthuizen')).toBe('LO')
    expect(iconInitials('Madiba')).toBe('MA')
    expect(iconInitials('  ')).toBe('?')
  })
})
