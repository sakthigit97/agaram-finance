import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import {
  ArrowDownLeft,
  Banknote,
  LayoutDashboard,
  KeyRound,
  Landmark,
  LogOut,
  Plus,
  Settings2,
  UsersRound,
  WalletCards,
} from 'lucide-react'
import type { FinanceAction } from '../types/finance'
import type { ApiPrincipal } from '../lib/api'

const links = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/customers', label: 'Customers', icon: UsersRound },
  { to: '/agents', label: 'Agents', icon: UsersRound },
  { to: '/loans', label: 'Loans', icon: WalletCards },
  { to: '/collections', label: 'Collections', icon: ArrowDownLeft },
  { to: '/expenses', label: 'Expenses', icon: Banknote },
  { to: '/investments', label: 'Investments', icon: Landmark },
  { to: '/financial-reports', label: 'Financial reports', icon: WalletCards },
]

export function AppSidebar({
  onCreate,
  onLogout,
  onChangePassword,
  principal,
  canManage,
  canAdmin,
}: {
  onCreate: (action: FinanceAction) => void
  onLogout: () => void
  onChangePassword: () => void
  principal: ApiPrincipal
  canManage: boolean
  canAdmin: boolean
}) {
  const [quickOpen, setQuickOpen] = useState(false)

  return (
    <aside className="sidebar">
      <a href="/" className="brand" aria-label="Agaram Finance home">
        <span className="brand-mark">a</span>
        <span className="brand-name">agaram<span>finance</span></span>
      </a>

      {/* <div className="workspace-switcher">
        <span className="workspace-avatar">A</span>
        <span className="workspace-copy"><strong>Agaram Finance</strong><small>Business workspace</small></span>
      </div> */}

      {canManage && <button className="button button-primary sidebar-create" aria-label="New entry" onClick={() => setQuickOpen((open) => !open)}>
        <Plus size={17} strokeWidth={2.4} />
        <span>New entry</span>
        <span className="shortcut">New</span>
      </button>}
      {quickOpen && canManage && (
        <div className="quick-menu">
          <button onClick={() => { onCreate('customer'); setQuickOpen(false) }}>Add a customer</button>
          {canAdmin && <button onClick={() => { onCreate('staff'); setQuickOpen(false) }}>Add an agent</button>}
          <button onClick={() => { onCreate('loan'); setQuickOpen(false) }}>Create a loan</button>
          <button onClick={() => { onCreate('payment'); setQuickOpen(false) }}>Record a payment</button>
        </div>
      )}

      <span className="nav-caption">WORKSPACE</span>
      <nav className="primary-nav" aria-label="Main navigation">
        {links.filter(({ label }) => (canManage || label === 'Overview' || label === 'Loans')
            && (canAdmin || (label !== 'Agents' && label !== 'Financial reports'))
            && (principal.role !== 'STAFF' || label !== 'Overview')).map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} aria-label={label} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            <Icon size={18} strokeWidth={1.85} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-spacer" />
      <div className="sidebar-bottom">
        {canAdmin && <NavLink to="/reports" aria-label="Reports and administration" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
          <Settings2 size={18} strokeWidth={1.85} /><span>{canAdmin ? 'Reports & settings' : 'Reports & insights'}</span>
        </NavLink>}
        {principal.role !== 'CUSTOMER' && <button className="nav-link account-password-link" onClick={onChangePassword}>
          <KeyRound size={18} strokeWidth={1.85} /><span>Change password</span>
        </button>}
        <button className="profile-button" aria-label={`Sign out ${principal.name}`} onClick={onLogout}>
          <span className="profile-avatar">{initials(principal.name)}</span>
          <span className="workspace-copy"><strong>{principal.name}</strong><small>{principal.role.toLowerCase()}</small></span>
          <LogOut size={16} />
        </button>
      </div>
    </aside>
  )
}

function initials(name: string) {
  return name.split(' ').slice(0, 2).map((part) => part[0]).join('').toUpperCase()
}
