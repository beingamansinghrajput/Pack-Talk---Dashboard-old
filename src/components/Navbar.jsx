import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import logo from '../assets/logo.png'

export default function Navbar() {
  const { profile, isAdmin, isClient, canAccessOpsPages, roleLabel, signOut } = useAuth()
  const location = useLocation()
  const isActive = (path) => location.pathname === path
  const [menuOpen, setMenuOpen] = useState(false)

  // Close the mobile menu automatically whenever the route changes
  useEffect(() => {
    setMenuOpen(false)
  }, [location.pathname])

  // Lock background scroll while the mobile menu is open
  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [menuOpen])

  const links = isClient
    ? [{ to: '/', label: 'Dashboard' }]
    : [
        { to: '/', label: 'Dashboard' },
        { to: '/earnings', label: 'Earnings' },
        { to: '/link-generator', label: 'Link Generator' },
        canAccessOpsPages && { to: '/projects', label: 'Manage Projects' },
        canAccessOpsPages && { to: '/team', label: 'Team' },
        canAccessOpsPages && { to: '/exports', label: 'Exports' },
      ].filter(Boolean)

  return (
    <nav className="navbar">
      <div className="navbar-brand">
        <img src={logo} alt="PackTalk" className="brand-logo" />
        <span>PackTalk</span>
      </div>

      <div className="navbar-links">
        {links.map((l) => (
          <Link key={l.to} className={isActive(l.to) ? 'active' : ''} to={l.to}>
            {l.label}
          </Link>
        ))}
      </div>

      <div className="navbar-user">
        <div className="user-badge">
          <span className="user-name">{profile?.full_name || profile?.email}</span>
          <span className="user-role">{roleLabel}</span>
        </div>
        <button className="btn-ghost" onClick={signOut}>Sign out</button>
      </div>

      <button
        type="button"
        className={`navbar-burger ${menuOpen ? 'is-open' : ''}`}
        aria-label={menuOpen ? 'Close menu' : 'Open menu'}
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((v) => !v)}
      >
        <span />
        <span />
        <span />
      </button>

      <div className={`navbar-mobile-menu ${menuOpen ? 'is-open' : ''}`}>
        <div className="navbar-mobile-links">
          {links.map((l) => (
            <Link
              key={l.to}
              className={isActive(l.to) ? 'active' : ''}
              to={l.to}
              onClick={() => setMenuOpen(false)}
            >
              {l.label}
            </Link>
          ))}
        </div>
        <div className="navbar-mobile-user">
          <div className="user-badge">
            <span className="user-name">{profile?.full_name || profile?.email}</span>
            <span className="user-role">{roleLabel}</span>
          </div>
          <button className="btn-ghost" onClick={signOut}>Sign out</button>
        </div>
      </div>

      {menuOpen && (
        <div
          className="navbar-mobile-backdrop"
          onClick={() => setMenuOpen(false)}
          aria-hidden="true"
        />
      )}
    </nav>
  )
}
