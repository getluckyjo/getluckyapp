/**
 * The not-found page's header and tab bar both ask for the signed-in user.
 * Next can render that page outside the root layout, and so outside its
 * <AuthProvider>: a server-action POST with a malformed Next-Router-State-Tree
 * does it (a scanner on 29 Sep 2026, GET-LUCKY-GOLF-A), and it answered 500.
 */
import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))

describe('not-found page', () => {
  it('renders without an AuthProvider above it', async () => {
    const { default: NotFound } = await import('@/app/not-found')
    expect(renderToString(createElement(NotFound))).toContain('That page doesn')
  })
})
