'use client'

import { useState } from 'react'
import { BurgerIcon } from '@/components/icons'
import AppMenu from './AppMenu'

/**
 * V2 screen header — burger on the left, the small "Get Lucky" corner sticker
 * on the right. `tone="dark"` is for photo backgrounds (white burger);
 * `tone="light"` for the grey surface (green burger). The sticker carries its
 * own white halo so it reads on either.
 */
export default function AppHeader({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <>
      <header className={`app-header app-header--${tone}`}>
        <button
          type="button"
          className="app-header-burger"
          aria-label="Open menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(true)}
        >
          <BurgerIcon size={18} />
        </button>
        <img src="/brand/logo-corner.svg" alt="Get Lucky" className="app-header-logo" draggable={false} />
      </header>
      <AppMenu open={menuOpen} onClose={() => setMenuOpen(false)} />
    </>
  )
}
